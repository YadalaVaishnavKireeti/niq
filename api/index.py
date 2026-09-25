from io import BytesIO
import os
import secrets

import psycopg
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from pydantic import BaseModel, Field


app = FastAPI(title="Quiz Championship API")


TEAMS = [
    "Golconda",
    "⁠Charminar",
    "Chowmahalla",
    "King Koti",
    "Kundanbagh",
    "⁠Falaknuma",
    "Parda Gate",
    "Salarjung",
    "Purani haweli",
    "Lakdikapool",
    "Afzulgunj",
]


ROUNDS = [
    "ROUND 1: REEL TO REEL",
    "ROUND 2: NITI KE NUMBERS",
    "ROUND 3: CONNECT THE DOTS",
    "ROUND 4: GAME CHANGER"
]


class ScoreEntry(BaseModel):
    team: str
    round: str
    question: int = Field(ge=1, le=12)
    marks: int = Field(ge=1, le=100)
    operation: str = "add"


class ScoreUpdate(BaseModel):
    team: str | None = None
    round: str | None = None
    question: int | None = Field(default=None, ge=1, le=12)
    marks: int | None = Field(default=None, ge=1, le=100)
    operation: str | None = None


class CurrentRoundUpdate(BaseModel):
    round: str


class ClapAck(BaseModel):
    event_id: int


def get_connection():
    database_url = os.environ.get("DATABASE_URL")

    if not database_url:
        raise RuntimeError(
            "DATABASE_URL is not configured."
        )

    return psycopg.connect(database_url)


def verify_coordinator(pin: str | None) -> None:
    expected_pin = os.environ.get(
        "COORDINATOR_PIN"
    )

    if not expected_pin:
        raise HTTPException(
            status_code=500,
            detail="Coordinator PIN is not configured."
        )

    if not pin or not secrets.compare_digest(
        pin,
        expected_pin
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid coordinator PIN."
        )


def initialize_database() -> None:

    with get_connection() as conn:

        with conn.cursor() as cur:

            cur.execute("""
                CREATE TABLE IF NOT EXISTS scores (
                    id SERIAL PRIMARY KEY,
                    team VARCHAR(100) NOT NULL,
                    round VARCHAR(100) NOT NULL,
                    marks INTEGER NOT NULL CHECK (marks >= 0),
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)

            cur.execute(
                "ALTER TABLE scores ADD COLUMN IF NOT EXISTS question INTEGER"
            )

            cur.execute(
                "ALTER TABLE scores ADD COLUMN IF NOT EXISTS operation VARCHAR(10)"
            )

            cur.execute(
                "UPDATE scores SET question = 1 WHERE question IS NULL"
            )

            cur.execute(
                "UPDATE scores SET operation = 'add' WHERE operation IS NULL"
            )

            cur.execute(
                "ALTER TABLE scores ALTER COLUMN question SET DEFAULT 1"
            )

            cur.execute(
                "ALTER TABLE scores ALTER COLUMN operation SET DEFAULT 'add'"
            )

            cur.execute(
                "ALTER TABLE scores ALTER COLUMN question SET NOT NULL"
            )

            cur.execute(
                "ALTER TABLE scores ALTER COLUMN operation SET NOT NULL"
            )

            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_scores_team ON scores(team)"
            )

            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_scores_round ON scores(round)"
            )

            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_scores_question ON scores(question)"
            )

            cur.execute("""
                CREATE TABLE IF NOT EXISTS contest_settings (
                    id INTEGER PRIMARY KEY,
                    current_round VARCHAR(100) NOT NULL
                )
            """)

            cur.execute("""
                INSERT INTO contest_settings (id, current_round)
                VALUES (1, %s)
                ON CONFLICT (id) DO NOTHING
            """, (ROUNDS[0],))

            cur.execute("""
                CREATE TABLE IF NOT EXISTS clap_events (
                    id SERIAL PRIMARY KEY,
                    status VARCHAR(20) NOT NULL DEFAULT 'pending',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    played_at TIMESTAMPTZ
                )
            """)

            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_clap_events_status
                ON clap_events(status)
            """)

            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_clap_events_created
                ON clap_events(created_at)
            """)

        conn.commit()


@app.get("/api")
def home():
    return {
        "status": "ok",
        "message": "Quiz Championship API is running"
    }


@app.get("/api/config")
def get_config(
    x_coordinator_pin: str | None = Header(default=None)
):
    verify_coordinator(x_coordinator_pin)

    return {
        "teams": TEAMS,
        "rounds": ROUNDS,
        "questions": list(range(1, 13))
    }


@app.post("/api/scores")
def add_score(
    entry: ScoreEntry,
    x_coordinator_pin: str | None = Header(default=None)
):
    verify_coordinator(x_coordinator_pin)

    if entry.team not in TEAMS:
        raise HTTPException(
            status_code=400,
            detail="Invalid team."
        )

    if entry.round not in ROUNDS:
        raise HTTPException(
            status_code=400,
            detail="Invalid round."
        )

    operation = entry.operation.lower()

    if operation not in {"add", "subtract"}:
        raise HTTPException(
            status_code=400,
            detail="Operation must be add or subtract."
        )

    with get_connection() as conn:

        with conn.cursor() as cur:

            cur.execute("""
                INSERT INTO scores
                    (team, round, question, marks, operation)
                VALUES
                    (%s, %s, %s, %s, %s)
                RETURNING id, created_at
            """, (
                entry.team,
                entry.round,
                entry.question,
                entry.marks,
                operation
            ))

            result = cur.fetchone()

        conn.commit()

    signed_marks = (
        entry.marks
        if operation == "add"
        else -entry.marks
    )

    action = (
        "added to"
        if operation == "add"
        else "subtracted from"
    )

    return {
        "success": True,
        "message": f"{entry.marks} points {action} {entry.team}.",
        "id": result[0],
        "created_at": result[1].isoformat(),
        "signed_marks": signed_marks,
    }


@app.get("/api/leaderboard")
def get_leaderboard():

    with get_connection() as conn:

        with conn.cursor() as cur:

            cur.execute("""
                SELECT
                    t.team,
                    COALESCE(
                        SUM(
                            CASE
                                WHEN s.operation = 'subtract'
                                THEN -s.marks
                                ELSE s.marks
                            END
                        ),
                        0
                    ) AS total_score,
                    COUNT(s.id) AS entries,
                    MAX(s.created_at) AS last_updated
                FROM (
                    SELECT unnest(%s::text[]) AS team
                ) AS t
                LEFT JOIN scores s
                    ON s.team = t.team
                GROUP BY t.team
                ORDER BY total_score DESC, t.team ASC
            """, (TEAMS,))

            rows = cur.fetchall()

    return [
        {
            "rank": position,
            "team": row[0],
            "total_score": row[1],
            "entries": row[2],
            "last_updated": (
                row[3].isoformat()
                if row[3]
                else None
            ),
        }
        for position, row in enumerate(
            rows,
            start=1
        )
    ]


@app.get("/api/scores")
def get_scores(
    x_coordinator_pin: str | None = Header(default=None)
):
    verify_coordinator(x_coordinator_pin)

    with get_connection() as conn:

        with conn.cursor() as cur:

            cur.execute("""
                SELECT
                    id,
                    team,
                    round,
                    question,
                    marks,
                    operation,
                    created_at
                FROM scores
                ORDER BY created_at DESC, id DESC
            """)

            rows = cur.fetchall()

    return [
        {
            "id": row[0],
            "team": row[1],
            "round": row[2],
            "question": row[3],
            "marks": row[4],
            "operation": row[5],
            "created_at": row[6].isoformat(),
            "signed_marks": (
                row[4]
                if row[5] == "add"
                else -row[4]
            ),
        }
        for row in rows
    ]


@app.put("/api/scores/{score_id}")
def update_score(
    score_id: int,
    entry: ScoreUpdate,
    x_coordinator_pin: str | None = Header(default=None)
):
    verify_coordinator(x_coordinator_pin)

    if (
        entry.team is not None
        and entry.team not in TEAMS
    ):
        raise HTTPException(
            status_code=400,
            detail="Invalid team."
        )

    if (
        entry.round is not None
        and entry.round not in ROUNDS
    ):
        raise HTTPException(
            status_code=400,
            detail="Invalid round."
        )

    if (
        entry.question is not None
        and not 1 <= entry.question <= 12
    ):
        raise HTTPException(
            status_code=400,
            detail="Question must be between 1 and 12."
        )

    if (
        entry.marks is not None
        and not 1 <= entry.marks <= 100
    ):
        raise HTTPException(
            status_code=400,
            detail="Marks must be between 1 and 100."
        )

    if (
        entry.operation is not None
        and entry.operation.lower()
        not in {"add", "subtract"}
    ):
        raise HTTPException(
            status_code=400,
            detail="Operation must be add or subtract."
        )

    with get_connection() as conn:

        with conn.cursor() as cur:

            cur.execute(
                "SELECT id FROM scores WHERE id = %s",
                (score_id,)
            )

            if not cur.fetchone():
                raise HTTPException(
                    status_code=404,
                    detail="Score entry not found."
                )

            cur.execute("""
                UPDATE scores
                SET
                    team = COALESCE(%s, team),
                    round = COALESCE(%s, round),
                    question = COALESCE(%s, question),
                    marks = COALESCE(%s, marks),
                    operation = COALESCE(%s, operation)
                WHERE id = %s
                RETURNING
                    id,
                    team,
                    round,
                    question,
                    marks,
                    operation,
                    created_at
            """, (
                entry.team,
                entry.round,
                entry.question,
                entry.marks,
                (
                    entry.operation.lower()
                    if entry.operation
                    else None
                ),
                score_id,
            ))

            row = cur.fetchone()

        conn.commit()

    return {
        "success": True,
        "entry": {
            "id": row[0],
            "team": row[1],
            "round": row[2],
            "question": row[3],
            "marks": row[4],
            "operation": row[5],
            "created_at": row[6].isoformat(),
            "signed_marks": (
                row[4]
                if row[5] == "add"
                else -row[4]
            ),
        },
    }


@app.delete("/api/scores/{score_id}")
def delete_score(
    score_id: int,
    x_coordinator_pin: str | None = Header(default=None)
):
    verify_coordinator(x_coordinator_pin)

    with get_connection() as conn:

        with conn.cursor() as cur:

            cur.execute(
                "DELETE FROM scores WHERE id = %s RETURNING id",
                (score_id,)
            )

            row = cur.fetchone()

        conn.commit()

    if not row:
        raise HTTPException(
            status_code=404,
            detail="Score entry not found."
        )

    return {
        "success": True,
        "id": score_id
    }


@app.get("/api/team-totals")
def get_team_totals(
    x_coordinator_pin: str | None = Header(default=None)
):
    verify_coordinator(x_coordinator_pin)

    with get_connection() as conn:

        with conn.cursor() as cur:

            cur.execute("""
                SELECT
                    t.team,
                    COALESCE(
                        SUM(
                            CASE
                                WHEN s.operation = 'subtract'
                                THEN -s.marks
                                ELSE s.marks
                            END
                        ),
                        0
                    ) AS total_score
                FROM (
                    SELECT unnest(%s::text[]) AS team
                ) AS t
                LEFT JOIN scores s
                    ON s.team = t.team
                GROUP BY t.team
                ORDER BY total_score DESC, t.team ASC
            """, (TEAMS,))

            rows = cur.fetchall()

    return [
        {
            "team": row[0],
            "total_score": row[1]
        }
        for row in rows
    ]


@app.get("/api/current-round")
def get_current_round():

    with get_connection() as conn:

        with conn.cursor() as cur:

            cur.execute("""
                SELECT current_round
                FROM contest_settings
                WHERE id = 1
            """)

            result = cur.fetchone()

    return {
        "round": (
            result[0]
            if result
            else ROUNDS[0]
        )
    }


@app.put("/api/current-round")
def set_current_round(
    payload: CurrentRoundUpdate,
    x_coordinator_pin: str | None = Header(default=None)
):
    verify_coordinator(x_coordinator_pin)

    if payload.round not in ROUNDS:
        raise HTTPException(
            status_code=400,
            detail="Invalid round."
        )

    with get_connection() as conn:

        with conn.cursor() as cur:

            cur.execute("""
                INSERT INTO contest_settings
                    (id, current_round)
                VALUES
                    (1, %s)
                ON CONFLICT (id)
                DO UPDATE SET
                    current_round =
                        EXCLUDED.current_round
            """, (payload.round,))

        conn.commit()

    return {
        "success": True,
        "round": payload.round
    }


# =========================================================
# CLAP EVENTS
# =========================================================

@app.post("/api/clap")
def create_clap_event(
    x_coordinator_pin: str | None = Header(default=None)
):
    """
    Create a one-shot clap event.

    This is intentionally separate from score entry.
    Adding/subtracting/deleting scores NEVER creates
    a clap event.
    """

    verify_coordinator(x_coordinator_pin)

    with get_connection() as conn:

        with conn.cursor() as cur:

            cur.execute("""
                INSERT INTO clap_events (status)
                VALUES ('pending')
                RETURNING id, created_at
            """)

            row = cur.fetchone()

        conn.commit()

    return {
        "success": True,
        "event_id": row[0],
        "created_at": row[1].isoformat(),
        "status": "pending"
    }


@app.get("/api/clap/pending")
def get_pending_clap(
    after_id: int = 0
):
    """
    Public dashboard polls this endpoint.

    It returns the first pending clap event
    newer than after_id.
    """

    with get_connection() as conn:

        with conn.cursor() as cur:

            cur.execute("""
                SELECT
                    id,
                    created_at,
                    status
                FROM clap_events
                WHERE
                    status = 'pending'
                    AND id > %s
                ORDER BY id ASC
                LIMIT 1
            """, (after_id,))

            row = cur.fetchone()

    if not row:
        return {
            "event": None
        }

    return {
        "event": {
            "id": row[0],
            "created_at": row[1].isoformat(),
            "status": row[2]
        }
    }


@app.get("/api/clap/{event_id}")
def get_clap_status(event_id: int):

    with get_connection() as conn:

        with conn.cursor() as cur:

            cur.execute("""
                SELECT
                    id,
                    status,
                    created_at,
                    played_at
                FROM clap_events
                WHERE id = %s
            """, (event_id,))

            row = cur.fetchone()

    if not row:
        raise HTTPException(
            status_code=404,
            detail="Clap event not found."
        )

    return {
        "event_id": row[0],
        "status": row[1],
        "created_at": row[2].isoformat(),
        "played_at": (
            row[3].isoformat()
            if row[3]
            else None
        )
    }


@app.post("/api/clap/ack")
def acknowledge_clap(
    payload: ClapAck
):
    """
    Called by the public dashboard only after
    the clap audio has completely finished.
    """

    with get_connection() as conn:

        with conn.cursor() as cur:

            cur.execute("""
                UPDATE clap_events
                SET
                    status = 'played',
                    played_at = NOW()
                WHERE
                    id = %s
                    AND status = 'pending'
                RETURNING id, played_at
            """, (payload.event_id,))

            row = cur.fetchone()

        conn.commit()

    if not row:
        raise HTTPException(
            status_code=404,
            detail="Pending clap event not found."
        )

    return {
        "success": True,
        "event_id": row[0],
        "status": "played",
        "played_at": row[1].isoformat()
    }


# =========================================================
# EXCEL EXPORT
# =========================================================

@app.get("/api/export")
def export_excel(
    x_coordinator_pin: str | None = Header(default=None)
):
    verify_coordinator(x_coordinator_pin)

    with get_connection() as conn:

        with conn.cursor() as cur:

            cur.execute("""
                SELECT
                    id,
                    team,
                    round,
                    question,
                    operation,
                    marks,
                    created_at
                FROM scores
                ORDER BY created_at ASC, id ASC
            """)

            score_rows = cur.fetchall()

            cur.execute("""
                SELECT
                    t.team,
                    COALESCE(
                        SUM(
                            CASE
                                WHEN s.operation = 'subtract'
                                THEN -s.marks
                                ELSE s.marks
                            END
                        ),
                        0
                    ) AS total_score
                FROM (
                    SELECT unnest(%s::text[]) AS team
                ) AS t
                LEFT JOIN scores s
                    ON s.team = t.team
                GROUP BY t.team
                ORDER BY total_score DESC, t.team ASC
            """, (TEAMS,))

            leaderboard_rows = cur.fetchall()

            cur.execute("""
                SELECT current_round
                FROM contest_settings
                WHERE id = 1
            """)

            current_round_row = cur.fetchone()

    workbook = Workbook()

    sheet = workbook.active
    sheet.title = "Score Entries"

    sheet.append([
        "ID",
        "Team",
        "Round",
        "Question",
        "Operation",
        "Marks",
        "Signed Marks",
        "Time"
    ])

    for row in score_rows:

        signed = (
            row[5]
            if row[4] == "add"
            else -row[5]
        )

        sheet.append([
            row[0],
            row[1],
            row[2],
            row[3],
            row[4],
            row[5],
            signed,
            row[6].isoformat()
        ])

    leaderboard_sheet = workbook.create_sheet(
        "Leaderboard"
    )

    leaderboard_sheet.append([
        "Rank",
        "Team",
        "Total Score"
    ])

    for rank, row in enumerate(
        leaderboard_rows,
        start=1
    ):

        leaderboard_sheet.append([
            rank,
            row[0],
            row[1]
        ])

    settings_sheet = workbook.create_sheet(
        "Contest Info"
    )

    settings_sheet.append([
        "Current Round",
        (
            current_round_row[0]
            if current_round_row
            else ROUNDS[0]
        )
    ])

    settings_sheet.append([
        "Teams",
        len(TEAMS)
    ])

    settings_sheet.append([
        "Questions Per Round",
        12
    ])

    for worksheet in workbook.worksheets:

        for column in worksheet.columns:

            max_length = max(
                (
                    len(str(cell.value))
                    for cell in column
                    if cell.value is not None
                ),
                default=0
            )

            worksheet.column_dimensions[
                column[0].column_letter
            ].width = min(
                max_length + 3,
                40
            )

    output = BytesIO()

    workbook.save(output)

    output.seek(0)

    return StreamingResponse(
        output,
        media_type=(
            "application/vnd.openxmlformats-"
            "officedocument.spreadsheetml.sheet"
        ),
        headers={
            "Content-Disposition":
                'attachment; filename="quiz_scorebook.xlsx"'
        },
    )


try:
    initialize_database()
except Exception:
    pass