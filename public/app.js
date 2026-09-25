let currentRound = "";


/* =========================================================
   CLAP AUDIO
========================================================= */

/*
 * IMPORTANT:
 * Put the file here:
 *
 * public/audio/clap.mp3
 *
 * It will then be available at:
 *
 * /audio/clap.mp3
 */

const clapAudio =
    new Audio("/audio/clap.mp3");

clapAudio.preload = "auto";


/*
 * Clap is OFF by default.
 *
 * If the user previously turned it ON,
 * remember that choice using localStorage.
 */

let clapEnabled =
    localStorage.getItem(
        "clapSoundEnabled"
    ) === "true";


/*
 * Used to detect score changes.
 *
 * This remains null until the first
 * successful leaderboard load.
 */

let previousScores = null;


/* =========================================================
   CLAP TOGGLE BUTTON
========================================================= */

function setupClapToggle() {

    /*
     * Find the existing clap button.
     *
     * This works with the button class
     * already present in your CSS:
     *
     * .clap-toggle-button
     */

    const clapButton =
        document.querySelector(
            ".clap-toggle-button"
        );


    /*
     * If the button doesn't exist on
     * this page, simply do nothing.
     */

    if (!clapButton) {
        return;
    }


    /*
     * Prevent adding the event listener
     * more than once.
     */

    if (
        clapButton.dataset.clapReady === "true"
    ) {
        updateClapButton(
            clapButton
        );

        return;
    }


    clapButton.dataset.clapReady =
        "true";


    /*
     * Set the initial button state.
     */

    updateClapButton(
        clapButton
    );


    /*
     * Manual ON / OFF toggle.
     */

    clapButton.addEventListener(
        "click",
        async function () {

            clapEnabled =
                !clapEnabled;


            /*
             * Save the user's choice.
             */

            localStorage.setItem(
                "clapSoundEnabled",
                clapEnabled
                    ? "true"
                    : "false"
            );


            /*
             * Update button appearance.
             */

            updateClapButton(
                clapButton
            );


            /*
             * IMPORTANT:
             *
             * Playing the audio here after
             * a user click gives the browser
             * permission to use audio.
             *
             * We only do this when turning ON.
             */

            if (clapEnabled) {

                try {

                    clapAudio.currentTime = 0;

                    await clapAudio.play();

                } catch (error) {

                    console.error(
                        "Unable to play clap sound:",
                        error
                    );

                }

            }

        }
    );

}


/* =========================================================
   UPDATE CLAP BUTTON
========================================================= */

function updateClapButton(
    button
) {

    if (clapEnabled) {

        button.textContent =
            "🔊 Clap Sound: ON";

        button.classList.remove(
            "clap-disabled"
        );

    }

    else {

        button.textContent =
            "🔇 Clap Sound: OFF";

        button.classList.add(
            "clap-disabled"
        );

    }

}


/* =========================================================
   PLAY CLAP
========================================================= */

async function playClap() {

    /*
     * Never play if sound is disabled.
     */

    if (!clapEnabled) {
        return;
    }


    try {

        /*
         * Restart the sound from
         * the beginning.
         */

        clapAudio.currentTime = 0;


        await clapAudio.play();


    } catch (error) {

        console.error(
            "Clap audio could not be played:",
            error
        );

    }

}


/* =========================================================
   DETECT SCORE CHANGES
========================================================= */

function hasScoreChanged(
    leaderboard
) {

    /*
     * Create a simple snapshot:
     *
     * team name -> total score
     */

    const currentScores = {};


    leaderboard.forEach(
        (team) => {

            currentScores[
                team.team
            ] =
                Number(
                    team.total_score
                ) || 0;

        }
    );


    /*
     * First successful load:
     *
     * Store the scores but DO NOT clap.
     */

    if (
        previousScores === null
    ) {

        previousScores =
            currentScores;

        return false;

    }


    let changed = false;


    /*
     * Compare current scores
     * with the previous scores.
     */

    leaderboard.forEach(
        (team) => {

            const teamName =
                team.team;

            const oldScore =
                Number(
                    previousScores[
                        teamName
                    ]
                ) || 0;

            const newScore =
                Number(
                    team.total_score
                ) || 0;


            if (
                oldScore !== newScore
            ) {

                changed = true;

            }

        }
    );


    /*
     * Also store the latest scores.
     */

    previousScores =
        currentScores;


    return changed;

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


        const newRound =
            roundData.round;


        /*
         * Check whether a score changed.
         *
         * This is done before rendering.
         */

        const scoreChanged =
            hasScoreChanged(
                leaderboard
            );


        /*
         * Update current round.
         */

        currentRound =
            newRound;


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


        /*
         * Render leaderboard.
         */

        renderLeaderboard(
            leaderboard,
            currentRound
        );


        /*
         * Play one clap if a score
         * changed and sound is ON.
         */

        if (
            scoreChanged &&
            clapEnabled
        ) {

            playClap();

        }


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
   INITIALIZE CLAP CONTROL
========================================================= */

setupClapToggle();


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