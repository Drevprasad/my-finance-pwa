--
-- PostgreSQL database dump
--

\restrict m5bjevnIAcXTtspYSrVtqXOTWXub6ICue1BvcdG40jxnYHgna9sEeNH3ePtPYaS

-- Dumped from database version 17.11
-- Dumped by pg_dump version 17.12 (Ubuntu 17.12-1.pgdg24.04+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: assert_ledger_integrity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assert_ledger_integrity() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  v_txn   bigint := coalesce(new.txn_id, old.txn_id);
  v_count int;
  v_sum   bigint;
begin
  select count(*), coalesce(sum(amount_minor), 0)
    into v_count, v_sum
    from public.postings where txn_id = v_txn;

  if v_count = 0 then
    raise exception 'transaction % has no postings', v_txn
      using hint = 'Void the transaction; never delete its postings.';
  end if;
  if v_count < 2 then
    raise exception 'transaction % has only % posting(s); double entry needs >= 2', v_txn, v_count;
  end if;
  if v_sum <> 0 then
    raise exception 'transaction % is unbalanced: sum(amount_minor) = %', v_txn, v_sum;
  end if;
  return null;
end $$;


--
-- Name: category_trend(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.category_trend(p_months integer DEFAULT 6) RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$
with today as (
  select (now() at time zone 'Asia/Kolkata')::date as d
),
bounds as (
  select date_trunc('month', d)::date as this_month,
         (date_trunc('month', d) - make_interval(months => greatest(p_months, 1) - 1))::date as first_month
  from today
),
months as (
  select to_char(g, 'YYYY-MM') as period
  from bounds b, generate_series(b.first_month, b.this_month, interval '1 month') g
),
spend as (
  select p.category_id,
         coalesce(c.name, 'Uncategorised') as name,
         to_char(t.txn_date, 'YYYY-MM') as period,
         sum(p.amount_minor) as amount_minor
  from public.postings p
  join public.transactions t on t.id = p.txn_id and t.voided_at is null
  join public.accounts a on a.id = p.account_id and a.type = 'expense'
  left join public.categories c on c.id = p.category_id
  cross join bounds b
  where t.txn_date >= b.first_month
    and t.txn_date <  (b.this_month + interval '1 month')
  group by 1, 2, 3
),
cats as (select distinct category_id, name from spend)
select jsonb_build_object(
  'months', (select jsonb_agg(period order by period) from months),
  'categories', coalesce((
    select jsonb_agg(jsonb_build_object(
      'category_id', c.category_id,
      'name', c.name,
      'by_month', (
        select jsonb_agg(coalesce(s.amount_minor, 0) order by m.period)
        from months m
        left join spend s
          on s.period = m.period
         and s.category_id is not distinct from c.category_id
      )))
    from cats c), '[]'::jsonb)
);
$$;


--
-- Name: check_transaction_balance(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_transaction_balance() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  total_balance BIGINT;
BEGIN
  SELECT SUM(amount_minor) INTO total_balance FROM postings WHERE txn_id = NEW.txn_id;
  IF total_balance != 0 THEN
    RAISE EXCEPTION 'Transaction % is unbalanced. Total: %', NEW.txn_id, total_balance;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: create_transaction(date, text, text, text, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_transaction(p_date date, p_payee text, p_narration text, p_kind text, p_postings jsonb, p_notes text DEFAULT NULL::text) RETURNS bigint
    LANGUAGE plpgsql
    AS $$
declare
  v_uid   uuid := auth.uid();
  v_txn   bigint;
  v_sum   bigint;
  v_count int;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if p_postings is null or jsonb_typeof(p_postings) <> 'array' then
    raise exception 'p_postings must be a JSON array';
  end if;
  v_count := jsonb_array_length(p_postings);
  if v_count < 2 then raise exception 'need at least 2 postings'; end if;

  select coalesce(sum((e->>'amount_minor')::bigint), 0) into v_sum
    from jsonb_array_elements(p_postings) e;
  if v_sum <> 0 then
    raise exception 'postings must sum to zero in paise (got %)', v_sum;
  end if;

  insert into public.transactions (user_id, txn_date, payee, narration, notes, kind)
  values (v_uid, p_date, nullif(p_payee,''), nullif(p_narration,''), p_notes, coalesce(p_kind,'expense'))
  returning id into v_txn;

  insert into public.postings (user_id, txn_id, account_id, amount_minor, category_id)
  select v_uid, v_txn,
         (e->>'account_id')::bigint,
         (e->>'amount_minor')::bigint,
         nullif(e->>'category_id','')::bigint
  from jsonb_array_elements(p_postings) e;

  return v_txn;
end $$;


--
-- Name: dashboard_summary(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.dashboard_summary(p_ranges jsonb DEFAULT NULL::jsonb) RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$
with r as (
  select (e->>'from')::date as f, (e->>'to')::date as t
  from jsonb_array_elements(coalesce(p_ranges, '[]'::jsonb)) e
),
matched as (
  select t.id, t.txn_date
  from public.transactions t
  where t.voided_at is null
    and (not exists (select 1 from r)
         or exists (select 1 from r where t.txn_date between r.f and r.t))
),
post as (
  select p.amount_minor, p.category_id, a.type as acc_type, m.txn_date
  from public.postings p
  join matched m on m.id = p.txn_id
  join public.accounts a on a.id = p.account_id
),
span as (select coalesce(max(txn_date) - min(txn_date), 0) as days from post),
gran as (select case when (select days from span) <= 62 then 'day' else 'month' end as g),
tot as (
  select coalesce(sum(case when acc_type = 'income'  then -amount_minor end), 0) as income_minor,
         coalesce(sum(case when acc_type = 'expense' then  amount_minor end), 0) as expense_minor
  from post
),
cats as (
  select p.category_id,
         coalesce(c.name, 'Uncategorised') as name,
         sum(p.amount_minor) as amount_minor
  from post p
  left join public.categories c on c.id = p.category_id
  where p.acc_type = 'expense'
  group by 1, 2
  having sum(p.amount_minor) <> 0
),
periods as (
  select case g.g
           when 'day'   then to_char(p.txn_date, 'YYYY-MM-DD')
           else              to_char(p.txn_date, 'YYYY-MM')
         end as period,
         coalesce(sum(case when p.acc_type = 'income'  then -p.amount_minor end), 0) as income_minor,
         coalesce(sum(case when p.acc_type = 'expense' then  p.amount_minor end), 0) as expense_minor
  from post p cross join gran g
  group by 1
)
select jsonb_build_object(
  'income_minor',  (select income_minor  from tot),
  'expense_minor', (select expense_minor from tot),
  'by_category', coalesce((
     select jsonb_agg(jsonb_build_object('category_id', category_id, 'name', name,
                                         'amount_minor', amount_minor)
                      order by amount_minor desc)
     from cats), '[]'::jsonb),
  'by_period', coalesce((
     select jsonb_agg(jsonb_build_object('period', period,
                                         'income_minor', income_minor,
                                         'expense_minor', expense_minor)
                      order by period)
     from periods), '[]'::jsonb)
);
$$;


--
-- Name: ensure_defaults(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ensure_defaults() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO public.accounts (user_id, name, type, subtype, currency, is_active)
  SELECT v_uid, 'System Expense', 'expense', 'system', 'INR', true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.accounts WHERE user_id = v_uid AND type = 'expense'
  );

  INSERT INTO public.accounts (user_id, name, type, subtype, currency, is_active)
  SELECT v_uid, 'System Income', 'income', 'system', 'INR', true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.accounts WHERE user_id = v_uid AND type = 'income'
  );

  INSERT INTO public.accounts (user_id, name, type, subtype, currency, is_active)
  SELECT v_uid, 'Opening Balances', 'equity', 'system', 'INR', true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.accounts WHERE user_id = v_uid AND type = 'equity'
  );

  INSERT INTO public.categories (user_id, name, kind, is_active)
  SELECT v_uid, 'Uncategorized', 'expense', true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.categories WHERE user_id = v_uid AND kind = 'expense'
  );

  INSERT INTO public.categories (user_id, name, kind, is_active)
  SELECT v_uid, 'General Income', 'income', true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.categories WHERE user_id = v_uid AND kind = 'income'
  );
END;
$$;


--
-- Name: get_default_category(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_default_category(p_uid uuid, p_kind text) RETURNS bigint
    LANGUAGE sql STABLE
    AS $$ SELECT id FROM public.categories WHERE user_id = p_uid AND kind = p_kind AND is_active = true ORDER BY (CASE WHEN lower(name) = 'uncategorized' OR lower(name) = 'general income' THEN 0 ELSE 1 END), id LIMIT 1; $$;


--
-- Name: import_statement(bigint, jsonb, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.import_statement(p_account_id bigint, p_rows jsonb, p_file_name text DEFAULT 'statement.csv'::text, p_source_type text DEFAULT 'csv'::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_exp_acc bigint;
  v_inc_acc bigint;
  v_default_exp_cat bigint;
  v_default_inc_cat bigint;
  v_row jsonb;
  v_idx integer := 0;
  v_inserted integer := 0;
  v_skipped integer := 0;
  v_failed jsonb := '[]'::jsonb;
  v_date date;
  v_minor bigint;
  v_narr text;
  v_payee text;
  v_ref text;
  v_kind text;
  v_cat_id bigint;
  v_transfer_acc_id bigint;
  v_counter_acc bigint;
  v_rule_key text;
  v_day_seq integer;
  v_seq_map jsonb := '{}'::jsonb;
  v_seq_key text;
  v_hash text;
  v_txn_id bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.accounts WHERE id = p_account_id AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Target account not found';
  END IF;

  PERFORM public.ensure_defaults();

  SELECT id INTO v_exp_acc FROM public.accounts WHERE user_id = v_uid AND type = 'expense' LIMIT 1;
  SELECT id INTO v_inc_acc FROM public.accounts WHERE user_id = v_uid AND type = 'income' LIMIT 1;
  SELECT id INTO v_default_exp_cat FROM public.categories WHERE user_id = v_uid AND kind = 'expense' AND is_active = true ORDER BY id LIMIT 1;
  SELECT id INTO v_default_inc_cat FROM public.categories WHERE user_id = v_uid AND kind = 'income' AND is_active = true ORDER BY id LIMIT 1;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_idx := v_idx + 1;
    BEGIN
      v_date := (v_row->>'txn_date')::date;
      v_minor := (v_row->>'amount_minor')::bigint;
      v_narr := COALESCE(NULLIF(btrim(v_row->>'narration'), ''), 'Imported');
      v_payee := NULLIF(btrim(v_row->>'payee'), '');
      v_ref := NULLIF(btrim(v_row->>'ref'), '');
      v_kind := COALESCE(NULLIF(btrim(v_row->>'kind'), ''), CASE WHEN v_minor < 0 THEN 'expense' ELSE 'income' END);
      v_cat_id := NULLIF(v_row->>'category_id', '')::bigint;
      v_transfer_acc_id := NULLIF(v_row->>'transfer_account_id', '')::bigint;
      v_rule_key := NULLIF(btrim(v_row->>'rule_key'), '');

      IF v_date IS NULL OR v_minor IS NULL OR v_minor = 0 THEN
        RAISE EXCEPTION 'Invalid date or zero amount';
      END IF;

      -- Auto-match from rules if payee or category wasn't explicitly set
      IF v_payee IS NULL OR (v_cat_id IS NULL AND v_kind <> 'transfer') THEN
        SELECT
          COALESCE(v_payee, r.payee_name),
          COALESCE(v_cat_id, r.category_id)
        INTO v_payee, v_cat_id
        FROM public.rules r
        WHERE r.user_id = v_uid
          AND r.is_active = true
          AND upper(v_narr) LIKE '%' || upper(r.search_term) || '%'
        ORDER BY r.priority ASC, length(r.search_term) DESC
        LIMIT 1;
      END IF;

      -- Save / update rule in memory if user provided a clean payee and rule_key
      IF v_rule_key IS NOT NULL AND length(v_rule_key) >= 3 AND v_payee IS NOT NULL THEN
        IF EXISTS (
          SELECT 1 FROM public.rules
          WHERE user_id = v_uid AND upper(search_term) = upper(v_rule_key)
        ) THEN
          UPDATE public.rules
          SET name = v_payee,
              payee_name = v_payee,
              category_id = COALESCE(v_cat_id, category_id),
              is_active = true
          WHERE user_id = v_uid AND upper(search_term) = upper(v_rule_key);
        ELSE
          INSERT INTO public.rules (user_id, name, search_term, payee_name, category_id, priority, is_active)
          VALUES (v_uid, v_payee, v_rule_key, v_payee, v_cat_id, 100, true);
        END IF;
      END IF;

      v_seq_key := v_date::text || '|' || v_minor::text || '|' || COALESCE(v_ref, upper(left(v_narr, 48)));
      v_day_seq := COALESCE((v_seq_map->>v_seq_key)::integer, 0) + 1;
      v_seq_map := jsonb_set(v_seq_map, ARRAY[v_seq_key], to_jsonb(v_day_seq), true);

      v_hash := encode(
        sha256(
          convert_to(
            p_account_id::text || '|' || v_seq_key || '|seq=' || v_day_seq::text,
            'UTF8'
          )
        ),
        'hex'
      );

      IF EXISTS (
        SELECT 1 FROM public.transactions
        WHERE user_id = v_uid AND dedupe_hash = v_hash AND voided_at IS NULL
      ) THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      IF v_kind = 'transfer' AND v_transfer_acc_id IS NOT NULL AND v_transfer_acc_id <> p_account_id THEN
        v_counter_acc := v_transfer_acc_id;
        v_cat_id := NULL;
      ELSIF v_minor < 0 THEN
        v_kind := 'expense';
        v_counter_acc := v_exp_acc;
        v_cat_id := COALESCE(v_cat_id, v_default_exp_cat);
      ELSE
        v_kind := 'income';
        v_counter_acc := v_inc_acc;
        v_cat_id := COALESCE(v_cat_id, v_default_inc_cat);
      END IF;

      INSERT INTO public.transactions (
        user_id, txn_date, payee, narration, kind, dedupe_hash
      ) VALUES (
        v_uid, v_date, COALESCE(v_payee, 'Bank Import'), v_narr, v_kind, v_hash
      ) RETURNING id INTO v_txn_id;

      INSERT INTO public.postings (user_id, txn_id, account_id, amount_minor, category_id)
      VALUES
        (v_uid, v_txn_id, p_account_id, v_minor, NULL),
        (v_uid, v_txn_id, v_counter_acc, -v_minor, v_cat_id);

      v_inserted := v_inserted + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed || jsonb_build_array(
        jsonb_build_object('row', v_idx, 'reason', SQLERRM)
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'batch_id', NULL,
    'inserted', v_inserted,
    'skipped', v_skipped,
    'failed', v_failed
  );
END;
$$;


--
-- Name: set_account_opening_balance(bigint, bigint, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_account_opening_balance(p_account_id bigint, p_amount_minor bigint, p_date date DEFAULT CURRENT_DATE) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_acc_type text;
  v_equity_id bigint;
  v_txn_id bigint;
  v_signed_minor bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT type INTO v_acc_type
  FROM public.accounts
  WHERE id = p_account_id AND user_id = v_uid;

  IF v_acc_type IS NULL THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  PERFORM public.ensure_defaults();

  SELECT id INTO v_equity_id
  FROM public.accounts
  WHERE user_id = v_uid AND type = 'equity'
  ORDER BY id
  LIMIT 1;

  IF v_acc_type = 'liability' THEN
    v_signed_minor := -ABS(p_amount_minor);
  ELSE
    v_signed_minor := p_amount_minor;
  END IF;

  SELECT t.id INTO v_txn_id
  FROM public.transactions t
  JOIN public.postings p ON p.txn_id = t.id
  WHERE t.user_id = v_uid
    AND t.kind = 'opening'
    AND t.voided_at IS NULL
    AND p.account_id = p_account_id
  ORDER BY t.id DESC
  LIMIT 1;

  IF v_signed_minor = 0 THEN
    IF v_txn_id IS NOT NULL THEN
      PERFORM public.void_transactions(ARRAY[v_txn_id], 'opening balance set to zero');
    END IF;
    RETURN 0;
  END IF;

  IF v_txn_id IS NOT NULL THEN
    UPDATE public.transactions
    SET txn_date = COALESCE(p_date, txn_date)
    WHERE id = v_txn_id;

    DELETE FROM public.postings WHERE txn_id = v_txn_id;
  ELSE
    INSERT INTO public.transactions (user_id, txn_date, payee, narration, kind)
    VALUES (v_uid, COALESCE(p_date, CURRENT_DATE), 'Opening Balance', 'Initial account balance', 'opening')
    RETURNING id INTO v_txn_id;
  END IF;

  INSERT INTO public.postings (user_id, txn_id, account_id, amount_minor, category_id)
  VALUES
    (v_uid, v_txn_id, p_account_id, v_signed_minor, NULL),
    (v_uid, v_txn_id, v_equity_id, -v_signed_minor, NULL);

  RETURN v_txn_id;
END;
$$;


--
-- Name: update_transaction(bigint, date, text, text, text, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_transaction(p_txn_id bigint, p_date date, p_payee text, p_narration text, p_kind text, p_postings jsonb, p_notes text DEFAULT NULL::text) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_sum bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.transactions
    WHERE id = p_txn_id AND user_id = v_uid AND voided_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Transaction not found or already voided';
  END IF;

  IF jsonb_typeof(p_postings) <> 'array' OR jsonb_array_length(p_postings) < 2 THEN
    RAISE EXCEPTION 'At least 2 postings are required';
  END IF;

  SELECT COALESCE(SUM((elem->>'amount_minor')::bigint), 0)
  INTO v_sum
  FROM jsonb_array_elements(p_postings) AS elem;

  IF v_sum <> 0 THEN
    RAISE EXCEPTION 'Postings must sum to 0 (got %)', v_sum;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_postings) AS elem
    LEFT JOIN public.accounts a
      ON a.id = (elem->>'account_id')::bigint AND a.user_id = v_uid
    WHERE a.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Invalid account in postings';
  END IF;

  UPDATE public.transactions
  SET txn_date = p_date,
      payee = NULLIF(btrim(p_payee), ''),
      narration = COALESCE(NULLIF(btrim(p_narration), ''), narration),
      kind = p_kind,
      notes = NULLIF(btrim(p_notes), '')
  WHERE id = p_txn_id AND user_id = v_uid;

  DELETE FROM public.postings WHERE txn_id = p_txn_id;

  INSERT INTO public.postings (user_id, txn_id, account_id, amount_minor, category_id)
  SELECT
    v_uid,
    p_txn_id,
    (elem->>'account_id')::bigint,
    (elem->>'amount_minor')::bigint,
    NULLIF(elem->>'category_id', '')::bigint
  FROM jsonb_array_elements(p_postings) AS elem;

  RETURN p_txn_id;
END;
$$;


--
-- Name: void_transactions(bigint[], text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.void_transactions(p_ids bigint[], p_reason text DEFAULT 'manual void'::text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.transactions
  SET voided_at = now(),
      dedupe_hash = NULL,
      notes = COALESCE(notes || ' | ', '') || COALESCE(p_reason, 'voided')
  WHERE user_id = v_uid
    AND id = ANY(p_ids)
    AND voided_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounts (
    id bigint NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    subtype text NOT NULL,
    currency character(3) DEFAULT 'INR'::bpchar NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    user_id uuid DEFAULT auth.uid(),
    credit_limit_minor bigint,
    statement_day smallint,
    due_day smallint,
    CONSTRAINT accounts_type_check CHECK ((type = ANY (ARRAY['asset'::text, 'liability'::text, 'income'::text, 'expense'::text, 'equity'::text])))
);

ALTER TABLE ONLY public.accounts FORCE ROW LEVEL SECURITY;


--
-- Name: postings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.postings (
    id bigint NOT NULL,
    txn_id bigint NOT NULL,
    account_id bigint NOT NULL,
    category_id bigint,
    amount_minor bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    user_id uuid DEFAULT auth.uid(),
    currency character(3) DEFAULT 'INR'::bpchar NOT NULL,
    memo text
);

ALTER TABLE ONLY public.postings FORCE ROW LEVEL SECURITY;


--
-- Name: transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transactions (
    id bigint NOT NULL,
    txn_date date NOT NULL,
    payee text,
    narration text,
    notes text,
    status text DEFAULT 'posted'::text NOT NULL,
    dedupe_hash text,
    created_at timestamp with time zone DEFAULT now(),
    user_id uuid DEFAULT auth.uid(),
    kind text DEFAULT 'expense'::text NOT NULL,
    voided_at timestamp with time zone,
    voided_reason text,
    reverses_txn_id bigint,
    refund_of_txn_id bigint,
    import_batch_id bigint,
    external_ref text,
    dedupe_base text,
    CONSTRAINT transactions_status_check CHECK ((status = ANY (ARRAY['posted'::text, 'pending'::text, 'voided'::text])))
);

ALTER TABLE ONLY public.transactions FORCE ROW LEVEL SECURITY;


--
-- Name: account_balances; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.account_balances WITH (security_invoker='true') AS
 SELECT a.id,
    a.user_id,
    a.name,
    a.type,
    a.subtype,
    a.currency,
    a.is_active,
    (COALESCE(sum(p.amount_minor) FILTER (WHERE (t.id IS NOT NULL)), (0)::numeric))::bigint AS balance_minor
   FROM ((public.accounts a
     LEFT JOIN public.postings p ON ((p.account_id = a.id)))
     LEFT JOIN public.transactions t ON (((t.id = p.txn_id) AND (t.voided_at IS NULL))))
  GROUP BY a.id, a.user_id, a.name, a.type, a.subtype, a.currency, a.is_active;


--
-- Name: accounts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.accounts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: accounts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.accounts_id_seq OWNED BY public.accounts.id;


--
-- Name: categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categories (
    id bigint NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    parent_id bigint,
    user_id uuid DEFAULT auth.uid(),
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 100 NOT NULL,
    CONSTRAINT categories_kind_check CHECK ((kind = ANY (ARRAY['income'::text, 'expense'::text, 'transfer'::text])))
);

ALTER TABLE ONLY public.categories FORCE ROW LEVEL SECURITY;


--
-- Name: categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.categories_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.categories_id_seq OWNED BY public.categories.id;


--
-- Name: import_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.import_batches (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    file_name text,
    source_type text DEFAULT 'csv'::text NOT NULL,
    account_id bigint,
    rows_total integer DEFAULT 0 NOT NULL,
    rows_committed integer DEFAULT 0 NOT NULL,
    rows_duplicate integer DEFAULT 0 NOT NULL,
    rows_failed integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.import_batches FORCE ROW LEVEL SECURITY;


--
-- Name: import_batches_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.import_batches_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: import_batches_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.import_batches_id_seq OWNED BY public.import_batches.id;


--
-- Name: postings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.postings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: postings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.postings_id_seq OWNED BY public.postings.id;


--
-- Name: rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rules (
    id bigint NOT NULL,
    search_term text NOT NULL,
    payee_name text NOT NULL,
    category_id bigint,
    user_id uuid DEFAULT auth.uid(),
    priority integer DEFAULT 100 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    name text
);

ALTER TABLE ONLY public.rules FORCE ROW LEVEL SECURITY;


--
-- Name: rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rules_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rules_id_seq OWNED BY public.rules.id;


--
-- Name: transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.transactions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.transactions_id_seq OWNED BY public.transactions.id;


--
-- Name: accounts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts ALTER COLUMN id SET DEFAULT nextval('public.accounts_id_seq'::regclass);


--
-- Name: categories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories ALTER COLUMN id SET DEFAULT nextval('public.categories_id_seq'::regclass);


--
-- Name: import_batches id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_batches ALTER COLUMN id SET DEFAULT nextval('public.import_batches_id_seq'::regclass);


--
-- Name: postings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.postings ALTER COLUMN id SET DEFAULT nextval('public.postings_id_seq'::regclass);


--
-- Name: rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rules ALTER COLUMN id SET DEFAULT nextval('public.rules_id_seq'::regclass);


--
-- Name: transactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions ALTER COLUMN id SET DEFAULT nextval('public.transactions_id_seq'::regclass);


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


--
-- Name: accounts accounts_type_chk; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.accounts
    ADD CONSTRAINT accounts_type_chk CHECK ((type = ANY (ARRAY['asset'::text, 'liability'::text, 'income'::text, 'expense'::text, 'equity'::text]))) NOT VALID;


--
-- Name: accounts accounts_type_subtype_chk; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.accounts
    ADD CONSTRAINT accounts_type_subtype_chk CHECK (((type = ANY (ARRAY['income'::text, 'expense'::text, 'equity'::text])) OR (subtype = 'other'::text) OR ((type = 'asset'::text) AND (subtype = ANY (ARRAY['bank'::text, 'cash'::text, 'wallet'::text, 'investment'::text, 'fd'::text, 'system'::text]))) OR ((type = 'liability'::text) AND (subtype = ANY (ARRAY['credit_card'::text, 'loan'::text]))))) NOT VALID;


--
-- Name: categories categories_kind_chk; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.categories
    ADD CONSTRAINT categories_kind_chk CHECK ((kind = ANY (ARRAY['income'::text, 'expense'::text, 'transfer'::text]))) NOT VALID;


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- Name: import_batches import_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_batches
    ADD CONSTRAINT import_batches_pkey PRIMARY KEY (id);


--
-- Name: postings postings_amount_chk; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.postings
    ADD CONSTRAINT postings_amount_chk CHECK ((amount_minor <> 0)) NOT VALID;


--
-- Name: postings postings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.postings
    ADD CONSTRAINT postings_pkey PRIMARY KEY (id);


--
-- Name: rules rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rules
    ADD CONSTRAINT rules_pkey PRIMARY KEY (id);


--
-- Name: transactions transactions_kind_chk; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.transactions
    ADD CONSTRAINT transactions_kind_chk CHECK ((kind = ANY (ARRAY['expense'::text, 'income'::text, 'transfer'::text, 'reversal'::text, 'opening'::text, 'trade'::text, 'dividend'::text, 'fee'::text, 'refund'::text]))) NOT VALID;


--
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);


--
-- Name: transactions transactions_status_chk; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.transactions
    ADD CONSTRAINT transactions_status_chk CHECK ((status = ANY (ARRAY['pending'::text, 'posted'::text, 'voided'::text]))) NOT VALID;


--
-- Name: transactions transactions_voided_chk; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.transactions
    ADD CONSTRAINT transactions_voided_chk CHECK (((status <> 'voided'::text) OR (voided_at IS NOT NULL))) NOT VALID;


--
-- Name: postings_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX postings_account_idx ON public.postings USING btree (account_id);


--
-- Name: postings_txn_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX postings_txn_idx ON public.postings USING btree (txn_id);


--
-- Name: postings_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX postings_user_idx ON public.postings USING btree (user_id);


--
-- Name: transactions_base_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX transactions_base_idx ON public.transactions USING btree (user_id, dedupe_base) WHERE (dedupe_base IS NOT NULL);


--
-- Name: transactions_user_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX transactions_user_date_idx ON public.transactions USING btree (user_id, txn_date DESC, id DESC);


--
-- Name: uq_transactions_active_dedupe; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_transactions_active_dedupe ON public.transactions USING btree (user_id, dedupe_hash) WHERE ((voided_at IS NULL) AND (dedupe_hash IS NOT NULL));


--
-- Name: postings postings_ledger_integrity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER postings_ledger_integrity AFTER INSERT OR DELETE OR UPDATE ON public.postings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_ledger_integrity();


--
-- Name: accounts accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: categories categories_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.categories(id);


--
-- Name: categories categories_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: import_batches import_batches_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_batches
    ADD CONSTRAINT import_batches_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE RESTRICT;


--
-- Name: import_batches import_batches_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_batches
    ADD CONSTRAINT import_batches_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: postings postings_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.postings
    ADD CONSTRAINT postings_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- Name: postings postings_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.postings
    ADD CONSTRAINT postings_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id);


--
-- Name: postings postings_txn_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.postings
    ADD CONSTRAINT postings_txn_id_fkey FOREIGN KEY (txn_id) REFERENCES public.transactions(id) ON DELETE CASCADE;


--
-- Name: postings postings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.postings
    ADD CONSTRAINT postings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: rules rules_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rules
    ADD CONSTRAINT rules_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id);


--
-- Name: rules rules_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rules
    ADD CONSTRAINT rules_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: transactions transactions_refund_of_txn_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_refund_of_txn_id_fkey FOREIGN KEY (refund_of_txn_id) REFERENCES public.transactions(id) ON DELETE RESTRICT;


--
-- Name: transactions transactions_reverses_txn_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_reverses_txn_id_fkey FOREIGN KEY (reverses_txn_id) REFERENCES public.transactions(id) ON DELETE RESTRICT;


--
-- Name: transactions transactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: accounts accounts_owner_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY accounts_owner_all ON public.accounts TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

--
-- Name: categories categories_owner_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY categories_owner_all ON public.categories TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: import_batches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;

--
-- Name: import_batches import_batches_owner_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY import_batches_owner_all ON public.import_batches TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: postings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.postings ENABLE ROW LEVEL SECURITY;

--
-- Name: postings postings_owner_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY postings_owner_all ON public.postings TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rules ENABLE ROW LEVEL SECURITY;

--
-- Name: rules rules_owner_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rules_owner_all ON public.rules TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: transactions transactions_owner_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY transactions_owner_all ON public.transactions TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- PostgreSQL database dump complete
--

\unrestrict m5bjevnIAcXTtspYSrVtqXOTWXub6ICue1BvcdG40jxnYHgna9sEeNH3ePtPYaS

