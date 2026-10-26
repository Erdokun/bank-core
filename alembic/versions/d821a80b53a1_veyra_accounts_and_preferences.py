"""Add settlement currencies, savings spaces and account preferences."""
from alembic import op
import sqlalchemy as sa

revision = "d821a80b53a1"
down_revision = "b242fb6022de"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("settings", sa.JSON(), nullable=False, server_default="{}"))
    op.add_column("users", sa.Column("token_version", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("accounts", sa.Column("currency", sa.String(3), nullable=False, server_default="EUR"))
    op.add_column("accounts", sa.Column("kind", sa.String(16), nullable=False, server_default="current"))
    op.add_column("accounts", sa.Column("goal", sa.BigInteger(), nullable=False, server_default="0"))


def downgrade():
    for name in ("goal", "kind", "currency"):
        op.drop_column("accounts", name)
    for name in ("token_version", "settings"):
        op.drop_column("users", name)
