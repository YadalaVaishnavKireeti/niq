let currentRound = "";
let previousLeaderboardSignature = "";

/*
 * PUBLIC DASHBOARD
 *
 * Clap audio is intentionally NOT tied to score changes.
 * A clap is only played when the coordinator manually triggers
 * a one-shot clap event from coordinator.html.
 */

const AudioContextClass =
    window.AudioContext || window.webkitAudioContext;

const clapAudioContext =
    AudioContextClass ? new AudioContextClass() : null;

let clapAudioBuffer = null;
let clapAudioLoading = null;

let dashboardSoundEnabled = false;
let clapPlaying = false;
let lastCompletedClapId = 0;
let armedClapBaselineId = 0;
let pendingClapEventId = null;


/* =========================================================
   DASHBOARD SOUND UNLOCK
========================================================= */

async function loadClapBuffer() {

    if (clapAudioBuffer) {
        return clapAudioBuffer;
    }

    if (clapAudioLoading) {
        return clapAudioLoading;
    }

    if (!clapAudioContext) {
        throw new Error("This browser does not support Web Audio.");
    }

    clapAudioLoading = fetch(
        "/audio/clap.mp3?audio=v6",
        { cache: "no-store" }
    )
        .then(async (response) => {
            if (!response.ok) {
                throw new Error(
                    `Clap audio file could not be loaded (HTTP ${response.status}).`
                );
            }
            const bytes = await response.arrayBuffer();
            return clapAudioContext.decodeAudioData(bytes);
        })
        .then((buffer) => {
            clapAudioBuffer = buffer;
            return buffer;
        })
        .finally(() => {
            clapAudioLoading = null;
        });

    return clapAudioLoading;
}


function showSoundError(button, message) {
    button.disabled = false;
    button.textContent = "🔊 Enable Dashboard Sound";
    button.classList.remove("sound-ready");
    button.classList.remove("sound-ready-hidden");
    button.setAttribute("aria-label", message);
    console.error(message);
}


function setupDashboardSound() {

    const button =
        document.getElementById("dashboard-sound-enable");

    if (!button) {
        return;
    }

    button.addEventListener("click", async () => {

        if (dashboardSoundEnabled) {
            return;
        }

        button.disabled = true;
        button.textContent = "⏳ Preparing Sound...";

        try {

            if (!clapAudioContext) {
                throw new Error(
                    "Web Audio is not supported by this browser."
                );
            }

            /*
             * This resume() happens directly inside the user's click.
             * That is the browser's required user-gesture unlock.
             */
            await clapAudioContext.resume();

            /*
             * Decode the REAL clap file before enabling the dashboard.
             * No sound is started here.
             */
            await loadClapBuffer();

            /*
             * Establish the event boundary only after audio is fully
             * ready. Events that existed before this point are stale.
             */
            const armResponse = await fetch(
                "/api/clap/arm?v=6",
                {
                    method: "POST",
                    cache: "no-store"
                }
            );

            if (!armResponse.ok) {
                const body = await armResponse.text();
                throw new Error(
                    `Dashboard sound could not connect to the clap service (HTTP ${armResponse.status}). ${body}`
                );
            }

            const armData = await armResponse.json();

            armedClapBaselineId =
                Number(armData.baseline_id) || 0;

            lastCompletedClapId =
                armedClapBaselineId;

            dashboardSoundEnabled = true;

            button.textContent = "🔊 Sound Ready";
            button.classList.add("sound-ready");
            button.setAttribute(
                "aria-label",
                "Dashboard sound is ready"
            );

            setTimeout(() => {
                button.classList.add("sound-ready-hidden");
            }, 1500);

            console.log(
                `Dashboard sound ready. Clap baseline: ${armedClapBaselineId}`
            );

        } catch (error) {

            dashboardSoundEnabled = false;
            showSoundError(
                button,
                `Dashboard sound setup failed: ${error.message || error}`
            );

            /* Keep the button usable so the operator can try again. */
        }
    });
}


/* =========================================================
   PLAY REMOTE CLAP
========================================================= */

async function playRemoteClap(eventId) {

    if (
        clapPlaying ||
        pendingClapEventId === eventId ||
        !dashboardSoundEnabled ||
        !clapAudioBuffer
    ) {
        return;
    }

    clapPlaying = true;
    pendingClapEventId = eventId;

    let source = null;

    try {

        /*
         * The AudioContext was resumed by the explicit dashboard click.
         * Do NOT create another context and do NOT use HTMLAudioElement.
         */
        if (clapAudioContext.state !== "running") {
            await clapAudioContext.resume();
        }

        source = clapAudioContext.createBufferSource();
        source.buffer = clapAudioBuffer;
        source.connect(clapAudioContext.destination);

        await new Promise((resolve, reject) => {

            let settled = false;

            source.onended = () => {
                if (settled) return;
                settled = true;
                resolve();
            };

            try {
                source.start(0);
            } catch (error) {
                if (settled) return;
                settled = true;
                reject(error);
            }
        });

        const completeResponse = await fetch(
            "/api/clap/complete",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ event_id: eventId }),
                cache: "no-store"
            }
        );

        if (!completeResponse.ok) {
            throw new Error(
                `Clap completion failed (HTTP ${completeResponse.status}).`
            );
        }

        lastCompletedClapId = eventId;

        console.log(
            `Remote clap ${eventId} played and acknowledged.`
        );

    } catch (error) {

        console.error(
            "Remote clap could not be played:",
            error
        );

        /*
         * Do NOT complete the DB event if playback failed. The event stays
         * pending, but the next poll is throttled until the current attempt
         * is released below. A later poll can retry it.
         */

    } finally {

        if (source) {
            try {
                source.disconnect();
            } catch (_) {}
        }

        clapPlaying = false;
        pendingClapEventId = null;
    }
}


/* =========================================================
   CHECK FOR COORDINATOR CLAP
========================================================= */

async function checkForClap() {

    if (!dashboardSoundEnabled || clapPlaying) {
        return;
    }

    try {

        const response = await fetch(
            "/api/clap/pending?v=6",
            { cache: "no-store" }
        );

        if (!response.ok) {
            return;
        }

        const data = await response.json();
        const event = data.event;

        if (!event) {
            return;
        }

        const eventId = Number(event.id);

        if (
            !eventId ||
            eventId <= armedClapBaselineId ||
            eventId <= lastCompletedClapId
        ) {
            return;
        }

        await playRemoteClap(eventId);

    } catch (error) {
        console.warn("Clap event check failed:", error);
    }
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
     * Positive-score teams occupy the ranked positions.
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

    const rankedTeams =
        positiveTeams.map(
            (team, index) => ({
                ...team,
                displayRank:
                    index < winnerCount
                        ? index + 1
                        : null,
                isWinner:
                    index < winnerCount
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
     * This means a zero-score team can never accidentally appear
     * as 🥇/🥈/🥉/🏅.
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

    const winnerSlots =
        [
            ...topTeams,
            ...Array(
                winnerCount - topTeams.length
            ).fill(null)
        ];

    const topRow =
        createLeaderboardRow(
            winnerSlots,
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

    return `
        <div class="${rowClass}">
            ${teams
                .map(
                    (team) =>
                        team
                            ? createTeamCard(
                                team,
                                team.displayRank,
                                isTopRow
                            )
                            : '<div class="leaderboard-slot-placeholder" aria-hidden="true"></div>'
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
    const isZeroScore =
        Number(team.total_score) <= 0;

    const isRankedWinner =
        Boolean(team.isWinner && rank);

    const colourClass =
        isRankedWinner
            ? `team-colour-${rank}`
            : "team-colour-unranked";

    let rankDisplay;

    if (isRankedWinner && rank === 1) {
        rankDisplay = "🥇";
    } else if (isRankedWinner && rank === 2) {
        rankDisplay = "🥈";
    } else if (isRankedWinner && rank === 3) {
        rankDisplay = "🥉";
    } else if (isRankedWinner && rank === 4) {
        rankDisplay = "🏅";
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

setupDashboardSound();
refreshDashboard();

/*
 * Scoreboard refresh.
 *
 * Three seconds keeps the existing leaderboard behaviour.
 * Clap events are checked separately every second so a remote
 * clap reaches the screen much faster.
 */
setInterval(
    refreshDashboard,
    3000
);

setInterval(
    checkForClap,
    1000
);

checkForClap();
