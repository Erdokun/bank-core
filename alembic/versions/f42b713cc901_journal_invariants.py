"""Enforce immutable journals and balanced settlement at PostgreSQL commit."""
from alembic import op

revision = "f42b713cc901"
down_revision = "e30a91c7b842"
branch_labels = depends_on = None


def upgrade():
    op.execute("""
    CREATE FUNCTION reject_journal_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'Records in % are immutable', TG_TABLE_NAME;
    END $$;
    """)
    op.execute("""CREATE TRIGGER immutable_ledger BEFORE UPDATE OR DELETE ON ledger_entries
      FOR EACH ROW EXECUTE FUNCTION reject_journal_mutation();
    """)
    op.execute("""CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON audit_events
      FOR EACH ROW EXECUTE FUNCTION reject_journal_mutation();
    """)
    op.execute("""CREATE FUNCTION verify_balanced_journal() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE tx_id integer;
    BEGIN
      IF TG_TABLE_NAME = 'transactions' THEN tx_id := NEW.id;
      ELSE tx_id := NEW.transaction_id; END IF;
      IF NOT EXISTS (SELECT 1 FROM ledger_entries WHERE transaction_id = tx_id) THEN
        RAISE EXCEPTION 'Transaction % has no journal entries', tx_id;
      END IF;
      IF EXISTS (
        SELECT a.currency FROM ledger_entries l JOIN accounts a ON a.id = l.account_id
        WHERE l.transaction_id = tx_id GROUP BY a.currency
        HAVING SUM(CASE WHEN l.entry_type = 'CREDIT' THEN l.amount ELSE -l.amount END) <> 0
      ) THEN RAISE EXCEPTION 'Unbalanced journal for transaction %', tx_id; END IF;
      RETURN NULL;
    END $$;
    """)
    op.execute("""CREATE CONSTRAINT TRIGGER balanced_transaction AFTER INSERT ON transactions
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_balanced_journal();
    """)
    op.execute("""CREATE CONSTRAINT TRIGGER balanced_entry AFTER INSERT ON ledger_entries
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_balanced_journal();
    """)


def downgrade():
    for statement in (
        "DROP TRIGGER balanced_entry ON ledger_entries",
        "DROP TRIGGER balanced_transaction ON transactions",
        "DROP TRIGGER immutable_audit ON audit_events",
        "DROP TRIGGER immutable_ledger ON ledger_entries",
        "DROP FUNCTION verify_balanced_journal()",
        "DROP FUNCTION reject_journal_mutation()",
    ):
        op.execute(statement)
