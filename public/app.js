let currentRound = "";

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


        document.getElementById(
            "current-round"
        ).textContent =
            roundData.round;


        renderLeaderboard(
            leaderboard,
            roundData.round
        );


    } catch (error) {

        console.error(
            "Dashboard update failed:",
            error
        );

    }

}

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
     * ROUND 4 = TOP 4
     * ALL OTHER ROUNDS = TOP 3
     */

    const isRound4 =
        currentRound.startsWith(
            "ROUND 4: GAME CHANGER"
        );


    const topCount =
        isRound4
            ? 4
            : 3;


    const topTeams =
        data.slice(
            0,
            topCount
        );


    const remainingTeams =
        data.slice(
            topCount
        );


    container.innerHTML = `

        <div
            class="
                top-ranking
                ${isRound4
                    ? "top-four"
                    : "top-three"}
            "
        >

            ${topTeams
                .map(
                    (team, index) =>
                        createTeamCard(
                            team,
                            index,
                            true
                        )
                )
                .join("")
            }

        </div>


        <div
            class="
                remaining-ranking
                ${isRound4
                    ? "remaining-six"
                    : "remaining-seven"}
            "
        >

            ${remainingTeams
                .map(
                    (team, index) =>
                        createTeamCard(
                            team,
                            topCount + index,
                            false
                        )
                )
                .join("")
            }

        </div>

    `;


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

function createTeamCard(team, index, isTop) {
    const colourClass = `team-colour-${index + 1}`;
    const rankDisplay =
        index === 0 ? "🥇" :
        index === 1 ? "🥈" :
        index === 2 ? "🥉" :
        index === 3 ? "🏅" :
        `#${index + 1}`;

    return `
        <article class="team-card ${isTop ? "top-team-card" : "remaining-team-card"} ${colourClass}">
            <div class="team-rank">${rankDisplay}</div>
            <div class="team-name">${escapeHtml(team.team)}</div>
            <div class="team-score">${team.total_score}<span> PTS</span></div>
        </article>`;
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

refreshDashboard();
setInterval(refreshDashboard, 3000);
