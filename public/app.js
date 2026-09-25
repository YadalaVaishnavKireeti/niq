let currentRound = "";
let previousLeaderboardSignature = "";

/*
 * PUBLIC DASHBOARD
 *
 * Clap audio is intentionally NOT tied to score changes.
 * A clap is only played when the coordinator manually triggers
 * a one-shot clap event from coordinator.html.
 */

const clapAudio = new Audio("/audio/clap.mp3");
clapAudio.preload = "auto";
clapAudio.crossOrigin = "anonymous";

let dashboardSoundEnabled = false;
let clapPlaying = false;
let lastCompletedClapId = 0;
let armedClapBaselineId = 0;
let pendingClapEventId = null;


/* =========================================================
   DASHBOARD SOUND UNLOCK
========================================================= */

/*
 * Use ONE HTMLAudioElement for the whole dashboard.
 *
 * The important browser-policy detail is that the audio element is
 * explicitly played from the real "Enable Sound" click. Once that
 * media element has been successfully started by the user's gesture,
 * later coordinator-triggered play() calls on the SAME element are
 * allowed in normal desktop browsers.
 */
function setupDashboardSound() {

    const button =
        document.getElementById(
            "dashboard-sound-enable"
        );

    if (!button) {
        return;
    }

    button.addEventListener(
        "click",
        async () => {

            button.disabled = true;
            button.textContent =
                "⏳ Preparing Sound...";

            try {

                clapAudio.load();

                /*
                 * Start the SAME audio element from the user gesture,
                 * but muted and immediately pause it. This is the
                 * browser unlock step; it does not play the clap to
                 * the audience.
                 */
                const originalVolume = clapAudio.volume;
                const originalMuted = clapAudio.muted;

                clapAudio.muted = true;
                clapAudio.volume = 0;
                clapAudio.currentTime = 0;

                await clapAudio.play();
                clapAudio.pause();
                clapAudio.currentTime = 0;

                clapAudio.muted = originalMuted;
                clapAudio.volume = originalVolume;

                /*
                 * ARM the dashboard at the moment the operator explicitly
                 * enables sound. Any clap events that existed before this
                 * moment are stale and must NEVER play.
                 */
                const armResponse = await fetch(
                    "/api/clap/arm",
                    {
                        method: "POST",
                        cache: "no-store"
                    }
                );

                if (!armResponse.ok) {
                    throw new Error(
                        `Dashboard sound arm failed (HTTP ${armResponse.status}).`
                    );
                }

                const armData = await armResponse.json();
                armedClapBaselineId = Number(armData.baseline_id) || 0;
                lastCompletedClapId = armedClapBaselineId;

                dashboardSoundEnabled = true;

                button.textContent =
                    "🔊 Sound Ready";

                button.classList.add(
                    "sound-ready"
                );

                button.setAttribute(
                    "aria-label",
                    "Dashboard sound is ready"
                );

                setTimeout(() => {
                    button.classList.add(
                        "sound-ready-hidden"
                    );
                }, 1200);

                console.log(
                    "Dashboard sound unlocked successfully."
                );

            } catch (error) {

                dashboardSoundEnabled = false;
                button.disabled = false;
                button.textContent =
                    "🔊 Tap to Enable Sound";

                console.error(
                    "Dashboard audio could not be enabled:",
                    error
                );
            }
        }
    );
}


/* =========================================================
   PLAY REMOTE CLAP
========================================================= */

async function playRemoteClap(eventId) {

    if (
        clapPlaying ||
        pendingClapEventId === eventId
    ) {
        return;
    }

    if (!dashboardSoundEnabled) {
        return;
    }

    clapPlaying = true;
    pendingClapEventId = eventId;

    try {

        /*
         * Reuse the EXACT audio element that was unlocked by the
         * dashboard user's click. Do not create a new media element
         * here, because that can re-trigger autoplay restrictions.
         */
        clapAudio.pause();
        clapAudio.currentTime = 0;

        await clapAudio.play();

        await new Promise((resolve, reject) => {

            let settled = false;

            const cleanup = () => {
                clapAudio.removeEventListener("ended", onEnded);
                clapAudio.removeEventListener("error", onError);
            };

            const onEnded = () => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve();
            };

            const onError = () => {
                if (settled) return;
                settled = true;
                cleanup();
                reject(
                    new Error(
                        "The clap audio element reported a playback error."
                    )
                );
            };

            clapAudio.addEventListener("ended", onEnded);
            clapAudio.addEventListener("error", onError);

            /*
             * If a very short/edge-case media event has already fired,
             * don't leave the coordinator waiting forever.
             */
            if (clapAudio.ended) {
                onEnded();
            }
        });

        const completeResponse = await fetch(
            "/api/clap/complete",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    event_id: eventId
                }),
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
         * Leave the DB event pending so the next poll can retry it.
         * This is intentional: a failed playback must never be
         * reported to the coordinator as successfully completed.
         */

    } finally {

        clapPlaying = false;
        pendingClapEventId = null;
    }
}


/* =========================================================
   CHECK FOR COORDINATOR CLAP
========================================================= */

async function checkForClap() {
    if (clapPlaying) {
        return;
    }

    try {
        const response = await fetch(
            "/api/clap/pending",
            {
                cache: "no-store"
            }
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

        /*
         * Only events created AFTER the dashboard was explicitly armed
         * are valid. This prevents old/stuck DB events from starting
         * applause as soon as sound is enabled.
         */
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
