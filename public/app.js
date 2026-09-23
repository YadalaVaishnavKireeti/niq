async function refreshDashboard() {

    try {

        await Promise.all([
            loadLeaderboard(),
            loadCurrentRound()
        ]);

    } catch (error) {

        console.error(
            "Dashboard update failed:",
            error
        );

    }

}


/* =========================
   LEADERBOARD
========================= */

async function loadLeaderboard() {

    const response =
        await fetch(
            "/api/leaderboard",
            {
                cache: "no-store"
            }
        );


    if (!response.ok) {

        throw new Error(
            "Leaderboard request failed."
        );

    }


    const data =
        await response.json();


    updatePodium(data);

    renderLeaderboard(data);

}


/* =========================
   PODIUM
========================= */

function updatePodium(data) {

    const first =
        data[0];

    const second =
        data[1];

    const third =
        data[2];


    document.getElementById(
        "first-team"
    ).textContent =
        first
            ? first.team
            : "—";


    document.getElementById(
        "first-score"
    ).textContent =
        first
            ? first.total_score
            : "0";


    document.getElementById(
        "second-team"
    ).textContent =
        second
            ? second.team
            : "—";


    document.getElementById(
        "second-score"
    ).textContent =
        second
            ? second.total_score
            : "0";


    document.getElementById(
        "third-team"
    ).textContent =
        third
            ? third.team
            : "—";


    document.getElementById(
        "third-score"
    ).textContent =
        third
            ? third.total_score
            : "0";

}


/* =========================
   FULL TABLE
========================= */

function renderLeaderboard(data) {

    const container =
        document.getElementById(
            "leaderboard"
        );


    if (!data.length) {

        container.innerHTML = `
            <div class="empty-state">

                <div>
                    🏁
                </div>

                <h3>
                    Quiz hasn't started yet
                </h3>

                <p>
                    Scores will appear here
                    as soon as the first round begins.
                </p>

            </div>
        `;

        return;
    }


    container.innerHTML =
        data.map(
            (team, index) => {

                const rankClass =
                    index === 0
                        ? "rank-one"
                        : index === 1
                        ? "rank-two"
                        : index === 2
                        ? "rank-three"
                        : "";


                const rankDisplay =
                    index === 0
                        ? "🥇"
                        : index === 1
                        ? "🥈"
                        : index === 2
                        ? "🥉"
                        : `#${team.rank}`;


                const entriesLabel =
                    team.entries === 1
                        ? "entry"
                        : "entries";


                return `
                    <div
                        class="
                            leaderboard-row
                            ${rankClass}
                        "
                    >

                        <div class="rank">
                            ${rankDisplay}
                        </div>


                        <div class="team-info">

                            <strong>
                                ${escapeHtml(
                                    team.team
                                )}
                            </strong>

                            <span>
                                ${team.entries}
                                score ${entriesLabel}
                            </span>

                        </div>


                        <div class="total-score">

                            ${team.total_score}

                            <small>
                                PTS
                            </small>

                        </div>

                    </div>
                `;

            }
        ).join("");


    document.getElementById(
        "last-updated"
    ).textContent =
        `Updated ${
            new Date().toLocaleTimeString(
                [],
                {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit"
                }
            )
        }`;

}


/* =========================
   CURRENT ROUND
========================= */

async function loadCurrentRound() {

    const response =
        await fetch(
            "/api/current-round",
            {
                cache: "no-store"
            }
        );


    if (!response.ok) {
        return;
    }


    const data =
        await response.json();


    document.getElementById(
        "current-round"
    ).textContent =
        data.round;

}


/* =========================
   SECURITY
========================= */

function escapeHtml(value) {

    return String(value)
        .replaceAll(
            "&",
            "&amp;"
        )
        .replaceAll(
            "<",
            "&lt;"
        )
        .replaceAll(
            ">",
            "&gt;"
        )
        .replaceAll(
            '"',
            "&quot;"
        )
        .replaceAll(
            "'",
            "&#039;"
        );

}


/* =========================
   START
========================= */

refreshDashboard();


setInterval(
    refreshDashboard,
    3000
);