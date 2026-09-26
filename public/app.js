let currentRound = "";
let previousLeaderboardSignature = "";

/*
 * PUBLIC DASHBOARD AUDIO
 *
 * Audio is completely local to the public dashboard.
 * There is no PostgreSQL event, coordinator polling,
 * Web Audio unlock step, or remote clap acknowledgement.
 */

const dashboardSounds = {
    // Local clap sound already included in this project.
    clap: new Audio("/audio/clap.mp3"),

    // Exact Google sound requested for OOPS.
    oops: new Audio(
        "https://actions.google.com/sounds/v1/cartoon/concussive_hit_guitar_boing.ogg"
    )
};

Object.values(dashboardSounds).forEach((audio) => {
    audio.preload = "auto";
    audio.loop = false;
});

function playDashboardSound(soundName, button) {
    const audio = dashboardSounds[soundName];

    if (!audio) {
        return;
    }

    try {
        audio.pause();
        audio.currentTime = 0;

        const playPromise = audio.play();

        if (playPromise && typeof playPromise.catch === "function") {
            playPromise.catch((error) => {
                console.error(
                    "Dashboard sound could not play:",
                    error
                );
            });
        }

        if (button) {
            button.classList.add("sound-playing");

            window.setTimeout(() => {
                button.classList.remove("sound-playing");
            }, Math.min(
                Math.max((audio.duration || 0.8) * 1000, 500),
                12000
            ));
        }
    } catch (error) {
        console.error(
            "Dashboard sound error:",
            error
        );
    }
}

function setupDashboardAudioControls() {
    document
        .querySelectorAll(".dashboard-audio-button")
        .forEach((button) => {
            button.addEventListener("click", () => {
                playDashboardSound(
                    button.dataset.audio,
                    button
                );
            });
        });
}


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

        if (!leaderboardResponse.ok || !roundResponse.ok) {
            throw new Error(
                "Dashboard update failed."
            );
        }

        const leaderboard =
            await leaderboardResponse.json();

        const roundData =
            await roundResponse.json();

        const newRound =
            roundData.round;

        currentRound =
            newRound;

        const currentRoundElement =
            document.getElementById(
                "current-round"
            );

        if (currentRoundElement) {
            currentRoundElement.textContent =
                currentRound;
        }

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
                    ${
                        currentRound.startsWith("ROUND 2:")
                            ? "Finals is not ready yet"
                            : "Quiz hasn't started yet"
                    }
                </h3>

                <p>
                    ${
                        currentRound.startsWith("ROUND 2:")
                            ? "The top two semifinal teams will appear here once they qualify."
                            : "Scores will appear here as soon as the first round begins."
                    }
                </p>
            </div>
        `;

        return;
    }

    const isFinals =
        currentRound.startsWith(
            "ROUND 2:"
        );

    /*
     * SEMI FINALS
     *
     * - Every team remains visible.
     * - Zero/negative scores show —.
     * - Only the top two positive scores receive
     *   positions 1 and 2.
     *
     * FINALS
     *
     * - API returns only the two semifinal qualifiers.
     * - Finals scores start from zero.
     * - Only Round 2 marks are displayed.
     */

    const positiveTeams =
        data.filter(
            (team) =>
                Number(team.total_score) > 0
        );

    const zeroTeams =
        data.filter(
            (team) =>
                Number(team.total_score) <= 0
        );

    const rankedTeams =
        isFinals
            ? data
                .slice(0, 2)
                .map(
                    (team, index) => ({
                        ...team,
                        displayRank:
                            index + 1,
                        isWinner: true
                    })
                )
            : positiveTeams.map(
                (team, index) => ({
                    ...team,

                    /*
                     * Only top two receive
                     * an actual position.
                     */
                    displayRank:
                        index < 2
                            ? index + 1
                            : null,

                    isWinner:
                        index < 2
                })
            );

    const unrankedTeams =
        isFinals
            ? []
            : zeroTeams.map(
                (team) => ({
                    ...team,
                    displayRank: null,
                    isWinner: false
                })
            );

    const orderedTeams = [
        ...rankedTeams,
        ...unrankedTeams
    ];

    /*
     * The first row is reserved for the
     * two semifinal/final positions.
     */
    const topTeams =
        rankedTeams.slice(0, 2);

    /*
     * Remaining semifinal teams are displayed
     * without ranking positions.
     */
    const remainingTeams =
        isFinals
            ? []
            : [
                ...rankedTeams.slice(2),
                ...unrankedTeams
            ];

    const secondRowTeams =
        remainingTeams.slice(0, 4);

    const thirdRowTeams =
        remainingTeams.slice(4);

    const topRow =
        createLeaderboardRow(
            topTeams,
            true,
            false
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
            false
        );

    const leaderboardSignature =
        orderedTeams
            .map(
                (team) =>
                    `${team.team}:${Number(
                        team.total_score
                    ) || 0}`
            )
            .join("|");

    const leaderboardChanged =
        leaderboardSignature !==
        previousLeaderboardSignature;

    previousLeaderboardSignature =
        leaderboardSignature;

    container.innerHTML = `
        ${topRow}
        ${secondRow}
        ${thirdRow}
    `;

    if (leaderboardChanged) {
        container.classList.remove(
            "leaderboard-changed"
        );

        void container.offsetWidth;

        container.classList.add(
            "leaderboard-changed"
        );
    }

    const lastUpdated =
        document.getElementById(
            "last-updated"
        );

    if (lastUpdated) {
        lastUpdated.textContent =
            `Updated ${new Date().toLocaleTimeString(
                [],
                {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit"
                }
            )}`;
    }

    if (leaderboardChanged) {
        requestAnimationFrame(() => {
            container
                .querySelectorAll(
                    ".team-card"
                )
                .forEach(
                    (card, index) => {
                        card.style.animationDelay =
                            `${Math.min(
                                index * 35,
                                250
                            )}ms`;

                        card.classList.add(
                            "scoreboard-enter"
                        );
                    }
                );
        });
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

    if (isTopRow) {
        rowClass =
            isRound4
                ? "leaderboard-top-row round-four-row"
                : "leaderboard-top-row round-one-three-row";
    } else if (teams.length === 4) {
        rowClass +=
            " leaderboard-four-row";
    } else {
        rowClass +=
            isRound4
                ? " leaderboard-bottom-row round-four-bottom-row"
                : " leaderboard-bottom-row round-one-three-bottom-row";
    }

    /*
     * Tell CSS exactly how many real cards
     * exist in this row.
     */
    rowClass +=
        ` row-count-${Math.min(
            Math.max(
                teams.length,
                1
            ),
            4
        )}`;

    return `
        <div class="${rowClass}">
            ${teams
                .map(
                    (team) =>
                        createTeamCard(
                            team,
                            team.displayRank,
                            isTopRow,
                            isRound4
                        )
                )
                .join("")}
        </div>
    `;
}


/* =========================================================
   CREATE TEAM CARD
========================================================= */

function createTeamCard(
    team,
    rank,
    isTop,
    isRound4
) {
    const isZeroScore =
        Number(team.total_score) <= 0;

    const isRankedWinner =
        Boolean(
            team.isWinner &&
            rank
        );

    const colourClass =
        isRankedWinner
            ? `team-colour-${rank}`
            : "team-colour-unranked";

    let rankDisplay;

    if (rank === 1) {
        rankDisplay =
            "🥇 1";
    } else if (rank === 2) {
        rankDisplay =
            "🥈 2";
    } else {
        rankDisplay =
            "—";
    }

    const winnerClass =
        isRankedWinner
            ? " winner-card"
            : "";

    const zeroClass =
        isZeroScore
            ? " zero-score-card"
            : "";

    return `
        <article
            class="
                team-card
                ${
                    isTop
                        ? "top-team-card"
                        : "remaining-team-card"
                }
                ${colourClass}
                ${winnerClass}
                ${zeroClass}
            "
        >
            <div class="team-rank">
                ${rankDisplay}
            </div>

            <div class="team-name">
                ${escapeHtml(team.team)}
            </div>

            <div class="team-score">
                ${Number(team.total_score) || 0}
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
   INITIALIZE
========================================================= */

setupDashboardAudioControls();

refreshDashboard();

/*
 * Scoreboard refresh.
 * Three seconds keeps the existing leaderboard behaviour.
 */
setInterval(
    refreshDashboard,
    3000
);