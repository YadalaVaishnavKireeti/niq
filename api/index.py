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
    "Alpha Warriors",
    "Beta Brains",
    "Gamma Giants",
    "Delta Digits",
    "Omega Outlaws",
]

ROUNDS = [
    "Round 1: Warm Up",
    "Round 2: Rapid Fire",
    "Round 3: Visual Round",
    "Round 4: Buzzer Round",
    "Round 5: Finale",
]


class ScoreEntry(BaseModel):
    team: str
    round: str
    marks: int = Field(ge=0, le=100)


class CurrentRoundUpdate(BaseModel):
    round: str


def get_connection():
    database_url = os.environ.get("DATABASE_URL")

    if not database_url:
        raise RuntimeError("DATABASE_URL is not configured.")

    return psycopg.connect(database_url)


def verify_coordinator(pin: str | None) -> None:
    expected_pin = os.environ.get("COORDINATOR_PIN")

    if not expected_pin:
        raise HTTPException(
            status_code=500,
            detail="Coordinator PIN is not configured.",
        )

    if not pin or not secrets.compare_digest(pin, expected_pin):
        raise HTTPException(
            status_code=401,
            detail="Invalid coordinator PIN.",
        )


def initialize_database() -> None:
    """
    Creates the application tables if they do not already exist.
    """

    with get_connection() as conn:

        with conn.cursor() as cur:

            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS scores (
                    id SERIAL PRIMARY KEY,
                    team VARCHAR(100) NOT NULL,
                    round VARCHAR(100) NOT NULL,
                    marks INTEGER NOT NULL CHECK (marks >= 0),
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )

            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_scores_team
                ON scores(team)
                """
            )

            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_scores_round
                ON scores(round)
                """
            )

            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS contest_settings (
                    id INTEGER PRIMARY KEY,
                    current_round VARCHAR(100) NOT NULL
                )
                """
            )

            cur.execute(
                """
                INSERT INTO contest_settings (id, current_round)
                VALUES (1, %s)
                ON CONFLICT (id) DO NOTHING
                """,
                (ROUNDS[0],),
            )

        conn.commit()


@app.get("/api")
def home():
    return {
        "status": "ok",
        "message": "Quiz Championship API is running",
    }


@app.get("/api/config")
def get_config(
    x_coordinator_pin: str | None = Header(default=None),
):
    verify_coordinator(x_coordinator_pin)

    return {
        "teams": TEAMS,
        "rounds": ROUNDS,
    }


@app.post("/api/scores")
def add_score(
    entry: ScoreEntry,
    x_coordinator_pin: str | None = Header(default=None),
):
    verify_coordinator(x_coordinator_pin)

    if entry.team not in TEAMS:
        raise HTTPException(
            status_code=400,
            detail="Invalid team.",
        )

    if entry.round not in ROUNDS:
        raise HTTPException(
            status_code=400,
            detail="Invalid round.",
        )

    if entry.marks <= 0:
        raise HTTPException(
            status_code=400,
            detail="Marks must be greater than zero.",
        )

    with get_connection() as conn:

        with conn.cursor() as cur:

            cur.execute(
                """
                INSERT INTO scores (
                    team,
                    round,
                    marks
                )
                VALUES (%s, %s, %s)
                RETURNING id, created_at
                """,
                (
                    entry.team,
                    entry.round,
                    entry.marks,
                ),
            )

            result = cur.fetchone()

        conn.commit()

    return {
        "success": True,
        "message": (
            f"{entry.marks} points added "
            f"to {entry.team}."
        ),
        "id": result[0],
        "created_at": result[1].isoformat(),
    }


@app.get("/api/leaderboard")
def get_leaderboard():

    with get_connection() as conn:

        with conn.cursor() as cur:

            cur.execute(
                """
                SELECT
                    t.team,
                    COALESCE(
                        SUM(s.marks),
                        0
                    ) AS total_score,
                    COUNT(s.id) AS entries,
                    MAX(s.created_at)
                        AS last_updated

                FROM (
                    SELECT
                        unnest(%s::text[]) AS team
                ) AS t

                LEFT JOIN scores s
                    ON s.team = t.team

                GROUP BY t.team

                ORDER BY
                    total_score DESC,
                    t.team ASC
                """,
                (TEAMS,),
            )

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
        for position, row
        in enumerate(rows, start=1)
    ]


@app.get("/api/scores")
def get_scores(
    x_coordinator_pin: str | None = Header(default=None),
):
    verify_coordinator(x_coordinator_pin)

    with get_connection() as conn:

        with conn.cursor() as cur:

            cur.execute(
                """
                SELECT
                    id,
                    team,
                    round,
                    marks,
                    created_at

                FROM scores

                ORDER BY created_at DESC
                """
            )

            rows = cur.fetchall()

    return [
        {
            "id": row[0],
            "team": row[1],
            "round": row[2],
            "marks": row[3],
            "created_at": row[4].isoformat(),
        }
        for row in rows
    ]


@app.get("/api/current-round")
def get_current_round():

    with get_connection() as conn:

        with conn.cursor() as cur:

            cur.execute(
                """
                SELECT current_round

                FROM contest_settings

                WHERE id = 1
                """
            )

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
    x_coordinator_pin: str | None = Header(default=None),
):
    verify_coordinator(x_coordinator_pin)

    if payload.round not in ROUNDS:
        raise HTTPException(
            status_code=400,
            detail="Invalid round.",
        )

    with get_connection() as conn:

        with conn.cursor() as cur:

            cur.execute(
                """
                INSERT INTO contest_settings (
                    id,
                    current_round
                )

                VALUES (1, %s)

                ON CONFLICT (id)
                DO UPDATE SET
                    current_round =
                        EXCLUDED.current_round
                """,
                (payload.round,),
            )

        conn.commit()

    return {
        "success": True,
        "round": payload.round,
    }


@app.get("/api/export")
def export_excel(
    x_coordinator_pin: str | None = Header(default=None),
):
    verify_coordinator(x_coordinator_pin)

    with get_connection() as conn:

        with conn.cursor() as cur:

            cur.execute(
                """
                SELECT
                    id,
                    team,
                    round,
                    marks,
                    created_at

                FROM scores

                ORDER BY created_at ASC
                """
            )

            score_rows = cur.fetchall()

            cur.execute(
                """
                SELECT
                    team,
                    COALESCE(
                        SUM(marks),
                        0
                    ) AS total_score

                FROM scores

                GROUP BY team

                ORDER BY
                    total_score DESC,
                    team ASC
                """
            )

            leaderboard_rows = cur.fetchall()

            cur.execute(
                """
                SELECT current_round

                FROM contest_settings

                WHERE id = 1
                """
            )

            current_round_row = cur.fetchone()

    workbook = Workbook()

    # --------------------------------
    # SCORE ENTRIES SHEET
    # --------------------------------

    sheet = workbook.active
    sheet.title = "Score Entries"

    sheet.append(
        [
            "ID",
            "Team",
            "Round",
            "Marks",
            "Time",
        ]
    )

    for row in score_rows:

        sheet.append(
            [
                row[0],
                row[1],
                row[2],
                row[3],
                row[4].isoformat(),
            ]
        )

    # --------------------------------
    # LEADERBOARD SHEET
    # --------------------------------

    leaderboard_sheet = workbook.create_sheet(
        "Leaderboard"
    )

    leaderboard_sheet.append(
        [
            "Rank",
            "Team",
            "Total Score",
        ]
    )

    for rank, row in enumerate(
        leaderboard_rows,
        start=1,
    ):

        leaderboard_sheet.append(
            [
                rank,
                row[0],
                row[1],
            ]
        )

    # --------------------------------
    # CONTEST INFO SHEET
    # --------------------------------

    settings_sheet = workbook.create_sheet(
        "Contest Info"
    )

    settings_sheet.append(
        [
            "Current Round",
            (
                current_round_row[0]
                if current_round_row
                else ROUNDS[0]
            ),
        ]
    )

    # --------------------------------
    # COLUMN WIDTHS
    # --------------------------------

    for worksheet in workbook.worksheets:

        for column in worksheet.columns:

            max_length = max(
                (
                    len(str(cell.value))
                    for cell in column
                    if cell.value is not None
                ),
                default=0,
            )

            worksheet.column_dimensions[
                column[0].column_letter
            ].width = min(
                max_length + 3,
                40,
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
                'attachment; '
                'filename="quiz_scorebook.xlsx"'
        },
    )


# Initialize database tables when a serverless
# instance starts.
try:
    initialize_database()
except Exception:
    # Requests will surface configuration/database
    # errors if the environment is not ready yet.
    pass