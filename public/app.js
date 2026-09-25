let currentRound = "";


/* =========================================================
   CLAP AUDIO
========================================================= */

const clapAudio =
    new Audio("/audio/clap.mp3");

clapAudio.preload = "auto";


/*
 * The dashboard does NOT automatically clap
 * when scores change.
 *
 * It only plays when the coordinator creates
 * an explicit clap event.
 */

let dashboardAudioUnlocked = false;

let lastClapEventId =
    Number(
        localStorage.getItem(
            "lastClapEventId"
        ) || 0
    );


/* =========================================================
   DASHBOARD SOUND UNLOCK
========================================================= */

function createSoundUnlockControl() {

    const existing =
        document.getElementById(
            "dashboard-sound-control"
        );


    if (existing) {
        return;
    }


    const control =
        document.createElement(
            "section"
        );


    control.id =
        "dashboard-sound-control";

    control.style.cssText = `
        position: fixed;
        right: 20px;
        bottom: 20px;
        z-index: 9999;
    `;


    const button =
        document.createElement(
            "button"
        );


    button.type =
        "button";

    button.id =
        "dashboard-sound-button";

    button.textContent =
        "🔇 Enable Clap Sound";

    button.style.cssText = `
        border: none;
        border-radius: 12px;
        padding: 12px 18px;
        font-size: 15px;
        font-weight: 800;
        cursor: pointer;
        background: #17834b;
        color: white;
        box-shadow: 0 4px 15px rgba(0,0,0,0.20);
    `;


    button.addEventListener(
        "click",
        async () => {

            try {

                /*
                 * This click unlocks audio playback
                 * for the dashboard browser.
                 */

                clapAudio.currentTime = 0;

                await clapAudio.play();

                clapAudio.pause();

                clapAudio.currentTime = 0;


                dashboardAudioUnlocked =
                    true;


                button.textContent =
                    "🔊 Clap Sound Ready";

                button.style.opacity =
                    "0.75";

                button.disabled =
                    true;


                setTimeout(
                    () => {

                        control.style.display =
                            "none";

                    },
                    1500
                );

            }

            catch (error) {

                console.error(
                    "Unable to enable dashboard audio:",
                    error
                );

                button.textContent =
                    "🔇 Click Again to Enable";

            }

        }
    );


    control.appendChild(
        button
    );


    document.body.appendChild(
        control
    );

}


/* =========================================================
   PLAY REMOTE CLAP
========================================================= */

async function playRemoteClap(
    eventId
) {

    /*
     * Prevent duplicate playback.
     */

    if (
        eventId <= lastClapEventId
    ) {

        return;

    }


    /*
     * The dashboard browser must have been
     * interacted with once.
     */

    if (
        !dashboardAudioUnlocked
    ) {

        console.warn(
            "Clap received, but dashboard audio has not been unlocked."
        );

        return;

    }


    try {

        clapAudio.currentTime =
            0;


        await clapAudio.play();


        /*
         * IMPORTANT:
         *
         * Wait for the ACTUAL audio to finish.
         *
         * Only then acknowledge the event.
         */

        await new Promise(
            (resolve) => {

                const handleEnded =
                    () => {

                        clapAudio.removeEventListener(
                            "ended",
                            handleEnded
                        );

                        resolve();

                    };


                clapAudio.addEventListener(
                    "ended",
                    handleEnded
                );

            }
        );


        /*
         * Remember the event locally so it
         * cannot be played twice by this dashboard.
         */

        lastClapEventId =
            eventId;


        localStorage.setItem(
            "lastClapEventId",
            String(eventId)
        );


        /*
         * Tell the backend that the sound has
         * COMPLETELY finished.
         */

        await fetch(
            "/api/clap/ack",
            {
                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify({
                        event_id:
                            eventId
                    }),

                cache:
                    "no-store"
            }
        );

    }

    catch (error) {

        console.error(
            "Clap audio could not be played:",
            error
        );

    }

}


/* =========================================================
   CHECK FOR REMOTE CLAP
========================================================= */

async function checkForClap() {

    try {

        const response =
            await fetch(
                `/api/clap/pending?after_id=${lastClapEventId}`,
                {
                    cache: "no-store"
                }
            );


        if (!response.ok) {
            return;
        }


        const data =
            await response.json();


        if (
            !data.event
        ) {

            return;

        }


        const eventId =
            Number(
                data.event.id
            );


        if (
            !Number.isInteger(eventId) ||
            eventId <= lastClapEventId
        ) {

            return;

        }


        await playRemoteClap(
            eventId
        );

    }

    catch (error) {

        console.error(
            "Unable to check for clap:",
            error
        );

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


        const currentRoundElement =
            document.getElementById(
                "current-round"
            );


        if (
            currentRoundElement
        ) {

            currentRoundElement.textContent =
                currentRound;

        }


        renderLeaderboard(
            leaderboard,
            currentRound
        );

    }

    catch (error) {

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


    const isRound4 =
        currentRound.startsWith(
            "ROUND 4:"
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


    const secondRowTeams =
        remainingTeams.slice(
            0,
            4
        );


    const thirdRowTeams =
        remainingTeams.slice(
            4
        );


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


    container.innerHTML = `

        ${topRow}

        ${secondRow}

        ${thirdRow}

    `;


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


    if (isTopRow) {

        rowClass +=
            isRound4
                ? " leaderboard-top-row round-four-row"
                : " leaderboard-top-row round-one-three-row";

    }

    else if (
        teams.length === 4
    ) {

        rowClass +=
            " leaderboard-four-row";

    }

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

    const colourClass =
        `team-colour-${rank}`;


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
   INITIALIZE
========================================================= */

createSoundUnlockControl();

refreshDashboard();

checkForClap();


/* =========================================================
   LEADERBOARD REFRESH
========================================================= */

setInterval(
    refreshDashboard,
    3000
);


/* =========================================================
   CLAP CHECK
========================================================= */

setInterval(
    checkForClap,
    1000
);