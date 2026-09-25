let currentRound = "";


/* =========================================================
   REFRESH DASHBOARD
========================================================= */

async function refreshDashboard() {

    try {

        const [
            leaderboardResponse,
            roundResponse
        ] = await Promise.all([

            fetch(
                "/api/leaderboard",
                {
                    cache: "no-store"
                }
            ),

            fetch(
                "/api/current-round",
                {
                    cache: "no-store"
                }
            )

        ]);


        if (
            !leaderboardResponse.ok ||
            !roundResponse.ok
        ) {
            throw new Error(
                "Dashboard update failed."
            );
        }


        const leaderboard =
            await leaderboardResponse.json();

        const roundData =
            await roundResponse.json();


        currentRound =
            roundData.round;


        document.getElementById(
            "current-round"
        ).textContent =
            currentRound;


        renderLeaderboard(
            leaderboard,
            currentRound
        );


    } catch (error) {

        console.error(
            "Dashboard update failed:",
            error
        );

    }

}


/* =========================================================
   RENDER LEADERBOARD
========================================================= */

function renderLeaderboard(
    data,
    currentRound
) {

    const container =
        document.getElementById(
            "leaderboard"
        );


    if (!data.length) {

        container.innerHTML = `
            <div class="empty-state">

                <div>🏁</div>

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


    /*
     * =====================================================
     * ROUND LAYOUT
     *
     * ROUNDS 1, 2, 3:
     *
     * Row 1 = 3 teams
     * Row 2 = 4 teams
     * Row 3 = 4 teams
     *
     * TOTAL = 11 TEAMS
     *
     *
     * ROUND 4:
     *
     * Row 1 = 4 teams
     * Row 2 = 4 teams
     * Row 3 = 3 teams
     *
     * TOTAL = 11 TEAMS
     * =====================================================
     */


    const isRound4 =
        currentRound.startsWith(
            "ROUND 4:"
        );


    const topCount =
        isRound4
            ? 4
            : 3;


    /*
     * Top teams
     */

    const topTeams =
        data.slice(
            0,
            topCount
        );


    /*
     * Remaining teams
     */

    const remainingTeams =
        data.slice(
            topCount
        );


    /*
     * Second row:
     * Always 4 teams
     */

    const secondRowTeams =
        remainingTeams.slice(
            0,
            4
        );


    /*
     * Third row:
     *
     * Rounds 1-3 = 4 teams
     * Round 4 = 3 teams
     */

    const thirdRowTeams =
        remainingTeams.slice(
            4
        );


    /*
     * Create the three rows
     */

    const topRow =
        createLeaderboardRow(
            topTeams,
            true,
            isRound4
        );


    const secondRow =
        createLeaderboardRow(
            secondRowTeams,
            false,
            false
        );


    const thirdRow =
        createLeaderboardRow(
            thirdRowTeams,
            false,
            isRound4
        );


    /*
     * Put all three rows into leaderboard
     */

    container.innerHTML = `

        ${topRow}

        ${secondRow}

        ${thirdRow}

    `;


    /*
     * Last updated time
     */

    const lastUpdated =
        document.getElementById(
            "last-updated"
        );


    if (lastUpdated) {

        lastUpdated.textContent =
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

}


/* =========================================================
   CREATE LEADERBOARD ROW
========================================================= */

function createLeaderboardRow(
    teams,
    isTopRow,
    isRound4
) {

    if (!teams.length) {
        return "";
    }


    let rowClass =
        "leaderboard-row";


    /*
     * First row
     */

    if (isTopRow) {

        rowClass +=
            isRound4
                ? " leaderboard-top-row round-four-row"
                : " leaderboard-top-row round-one-three-row";

    }


    /*
     * Second row
     */

    else if (
        teams.length === 4
    ) {

        rowClass +=
            " leaderboard-four-row";

    }


    /*
     * Third row
     *
     * Round 4 has 3 teams.
     * Rounds 1-3 have 4 teams.
     */

    else {

        rowClass +=
            isRound4
                ? " leaderboard-bottom-row round-four-bottom-row"
                : " leaderboard-bottom-row round-one-three-bottom-row";

    }


    return `
        <div class="${rowClass}">

            ${teams
                .map(
                    (team) =>
                        createTeamCard(
                            team,
                            team.rank,
                            isTopRow
                        )
                )
                .join("")
            }

        </div>
    `;

}


/* =========================================================
   CREATE TEAM CARD
========================================================= */

function createTeamCard(
    team,
    rank,
    isTop
) {

    /*
     * Team colour is based on
     * the team's current rank.
     */

    const colourClass =
        `team-colour-${rank}`;


    /*
     * Medal / rank display
     */

    let rankDisplay;


    if (rank === 1) {

        rankDisplay = "🥇";

    }

    else if (rank === 2) {

        rankDisplay = "🥈";

    }

    else if (rank === 3) {

        rankDisplay = "🥉";

    }

    else if (rank === 4) {

        rankDisplay = "🏅";

    }

    else {

        rankDisplay =
            `#${rank}`;

    }


    return `
        <article
            class="
                team-card
                ${isTop
                    ? "top-team-card"
                    : "remaining-team-card"}
                ${colourClass}
            "
        >

            <div class="team-rank">
                ${rankDisplay}
            </div>

            <div class="team-name">
                ${escapeHtml(team.team)}
            </div>

            <div class="team-score">
                ${team.total_score}
                <span> PTS</span>
            </div>

        </article>
    `;

}


/* =========================================================
   ESCAPE HTML
========================================================= */

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


/* =========================================================
   INITIAL LOAD
========================================================= */

refreshDashboard();


/* =========================================================
   AUTO REFRESH EVERY 3 SECONDS
========================================================= */

setInterval(
    refreshDashboard,
    3000
);