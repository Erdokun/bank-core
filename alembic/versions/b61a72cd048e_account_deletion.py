"""Account closure without rewriting immutable financial history."""
from alembic import op
import sqlalchemy as sa

revision = "b61a72cd048e"
down_revision = "a53c831ee782"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    op.drop_column("users", "deleted_at")
