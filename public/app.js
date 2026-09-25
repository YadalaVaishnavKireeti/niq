let currentRound = "";
let previousLeaderboardSignature = "";

/*
 * PUBLIC DASHBOARD AUDIO
 *
 * Audio is now completely local to the public dashboard. There is no
 * PostgreSQL event, coordinator polling, Web Audio unlock step, or remote
 * clap acknowledgement involved. Every sound is played only by a direct
 * button click on this page, so browser autoplay rules are satisfied.
 */

const dashboardSounds = {
    // Local clap sound already included in this project.
    clap: new Audio("/audio/clap.mp3"),

    // The exact Google sound requested for OOPS.
    oops: new Audio("https://actions.google.com/sounds/v1/cartoon/concussive_hit_guitar_boing.ogg")
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
                console.error("Dashboard sound could not play:", error);
            });
        }

        if (button) {
            button.classList.add("sound-playing");
            window.setTimeout(() => {
                button.classList.remove("sound-playing");
            }, Math.min(Math.max((audio.duration || 0.8) * 1000, 500), 12000));
        }
    } catch (error) {
        console.error("Dashboard sound error:", error);
    }
}

function setupDashboardAudioControls() {
    document.querySelectorAll(".dashboard-audio-button").forEach((button) => {
        button.addEventListener("click", () => {
            playDashboardSound(button.dataset.audio, button);
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
            throw new Error("Dashboard update failed.");
        }

        const leaderboard =
            await leaderboardResponse.json();

        const roundData =
            await roundResponse.json();

        const newRound = roundData.round;

        currentRound = newRound;

        const currentRoundElement =
            document.getElementById("current-round");

        if (currentRoundElement) {
            currentRoundElement.textContent = currentRound;
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

function renderLeaderboard(data, currentRound) {
    const container =
        document.getElementById("leaderboard");

    if (!data.length) {
        container.innerHTML = `
            <div class="empty-state">
                <div>🏁</div>
                <h3>Quiz hasn't started yet</h3>
                <p>Scores will appear here as soon as the first round begins.</p>
            </div>
        `;
        return;
    }

    const isRound4 =
        currentRound.startsWith("ROUND 4:");

    const winnerCount =
        isRound4 ? 4 : 3;

    /*
     * Every positive-score team occupies a ranked position.
     * Zero-score teams are deliberately not assigned ranks.
     *
     * The API already sorts by score and then team name, so this
     * preserves a deterministic order among teams with equal scores.
     */
    const positiveTeams =
        data.filter(
            (team) => Number(team.total_score) > 0
        );

    const zeroTeams =
        data.filter(
            (team) => Number(team.total_score) <= 0
        );

    // Every team with a positive score gets a real position.
    // The first 3 (or 4 in Round 4) remain the highlighted winner cards,
    // but positions continue through the rest of the positive-score teams.
    const rankedTeams =
        positiveTeams.map(
            (team, index) => ({
                ...team,
                displayRank: index + 1,
                isWinner: index < winnerCount
            })
        );

    const unrankedTeams =
        zeroTeams.map(
            (team) => ({
                ...team,
                displayRank: null,
                isWinner: false
            })
        );

    /*
     * Put all teams into the same score order, while ensuring
     * zero-score teams remain after every positive-score team.
     */
    const orderedTeams = [
        ...rankedTeams,
        ...unrankedTeams
    ];

    /*
     * Only teams with a positive score can occupy a winner slot.
     * All positive-score teams still keep their numbered position below
     * the highlighted winner cards.
     */
    const topTeams =
        rankedTeams.slice(
            0,
            winnerCount
        );

    /*
     * Every other team remains visible below the winner row.
     */
    const remainingTeams =
        [
            ...rankedTeams.slice(winnerCount),
            ...unrankedTeams
        ];

    const secondRowTeams =
        remainingTeams.slice(
            0,
            4
        );

    const thirdRowTeams =
        remainingTeams.slice(
            4
        );

    // Use only real winner cards. Empty placeholder slots are not created,
    // so removing a team will not leave a large artificial gap.
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

    const leaderboardSignature =
        orderedTeams
            .map(
                (team) =>
                    `${team.team}:${Number(team.total_score) || 0}`
            )
            .join("|");

    const leaderboardChanged =
        leaderboardSignature !== previousLeaderboardSignature;

    previousLeaderboardSignature =
        leaderboardSignature;

    container.innerHTML = `
        ${topRow}
        ${secondRow}
        ${thirdRow}
    `;

    if (leaderboardChanged) {
        container.classList.remove("leaderboard-changed");
        void container.offsetWidth;
        container.classList.add("leaderboard-changed");
    }

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

    /*
     * Animate cards only when the scores/order actually change,
     * rather than every three-second refresh.
     */
    if (leaderboardChanged) {
        requestAnimationFrame(() => {
            container
                .querySelectorAll(".team-card")
                .forEach((card, index) => {
                    card.style.animationDelay =
                        `${Math.min(index * 35, 250)}ms`;
                    card.classList.add("scoreboard-enter");
                });
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
        rowClass += isRound4
            ? " leaderboard-top-row round-four-row"
            : " leaderboard-top-row round-one-three-row";
    } else if (teams.length === 4) {
        rowClass += " leaderboard-four-row";
    } else {
        rowClass += isRound4
            ? " leaderboard-bottom-row round-four-bottom-row"
            : " leaderboard-bottom-row round-one-three-bottom-row";
    }

    // Tell CSS exactly how many real cards are in this row.
    rowClass += ` row-count-${Math.min(Math.max(teams.length, 1), 4)}`;

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
        Boolean(team.isWinner && rank);

    const colourClass =
        isRankedWinner
            ? `team-colour-${rank}`
            : "team-colour-unranked";

    let rankDisplay;

    if (rank === 1) {
        rankDisplay = "🥇 1";
    } else if (rank === 2) {
        rankDisplay = "🥈 2";
    } else if (rank === 3) {
        rankDisplay = "🥉 3";
    } else if (rank === 4 && isRound4) {
        // Round 4 has four highlighted medal positions.
        rankDisplay = "🏅 4";
    } else if (rank >= 4 && rank <= 10) {
        // Positions 4-10 are numbered; only Round 4's 4th place gets a medal.
        rankDisplay = `${rank}`;
    } else if (rank > 10) {
        rankDisplay = `#${rank}`;
    } else {
        rankDisplay = "—";
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
                ${isTop ? "top-team-card" : "remaining-team-card"}
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
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
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
