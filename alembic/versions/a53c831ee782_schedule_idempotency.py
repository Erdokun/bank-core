"""Persist scheduled-payment creation keys without changing existing schedules."""
from alembic import op
import sqlalchemy as sa

revision = "a53c831ee782"
down_revision = "f42b713cc901"
branch_labels = depends_on = None


def upgrade():
    op.add_column("scheduled_payments", sa.Column("request_key", sa.String(64)))
    op.add_column("scheduled_payments", sa.Column("request_hash", sa.String(64)))
    op.execute("UPDATE scheduled_payments SET request_key = 'legacy-' || id::text")
    op.alter_column("scheduled_payments", "request_key", nullable=False)
    op.create_unique_constraint("uq_scheduled_request_key", "scheduled_payments", ["request_key"])


def downgrade():
    op.drop_constraint("uq_scheduled_request_key", "scheduled_payments")
    op.drop_column("scheduled_payments", "request_hash")
    op.drop_column("scheduled_payments", "request_key")
