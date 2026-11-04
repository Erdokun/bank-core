"""Durable journal metadata, beneficiaries, scheduled payments and audit events."""
from alembic import op
import sqlalchemy as sa

revision = "e30a91c7b842"
down_revision = "d821a80b53a1"
branch_labels = depends_on = None


def upgrade():
    op.add_column("transactions", sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id")))
    op.add_column("transactions", sa.Column("request_hash", sa.String(64)))
    op.add_column("transactions", sa.Column("kind", sa.String(32), nullable=False, server_default="transfer"))
    op.add_column("transactions", sa.Column("reference", sa.String(140), nullable=False, server_default=""))
    op.create_index("ix_transactions_user_id", "transactions", ["user_id"])
    op.create_check_constraint("account_nonnegative_balance", "accounts", "balance >= 0 OR kind = 'clearing'")
    op.create_check_constraint("account_nonnegative_goal", "accounts", "goal >= 0")
    op.create_check_constraint("ledger_positive_amount", "ledger_entries", "amount > 0")
    op.create_table("beneficiaries", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False), sa.Column("account_id", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=False), sa.Column("name", sa.String(100), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_beneficiaries_user_id", "beneficiaries", ["user_id"])
    op.create_table("scheduled_payments", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False), sa.Column("source_account_id", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=False), sa.Column("destination_account_id", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=False), sa.Column("amount", sa.BigInteger(), nullable=False), sa.Column("reference", sa.String(140), nullable=False), sa.Column("due_at", sa.DateTime(timezone=True), nullable=False), sa.Column("status", sa.String(16), nullable=False), sa.Column("failure_reason", sa.String(255)), sa.Column("transaction_id", sa.Integer(), sa.ForeignKey("transactions.id")), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False), sa.CheckConstraint("amount > 0", name="schedule_positive_amount"))
    for column in ("user_id", "due_at", "status"):
        op.create_index("ix_scheduled_payments_" + column, "scheduled_payments", [column])
    op.create_table("audit_events", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False), sa.Column("action", sa.String(48), nullable=False), sa.Column("details", sa.JSON(), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_audit_events_user_id", "audit_events", ["user_id"])


def downgrade():
    for table in ("audit_events", "scheduled_payments", "beneficiaries"):
        op.drop_table(table)
    op.drop_constraint("ledger_positive_amount", "ledger_entries")
    op.drop_constraint("account_nonnegative_goal", "accounts")
    op.drop_constraint("account_nonnegative_balance", "accounts")
    for column in ("reference", "kind", "request_hash", "user_id"):
        op.drop_column("transactions", column)
