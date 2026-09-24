let currentRound = "";

async function refreshDashboard() {
    try {
        const [roundResponse, leaderboardResponse] = await Promise.all([
            fetch("/api/current-round", { cache: "no-store" }),
            fetch("/api/leaderboard", { cache: "no-store" }),
        ]);

        if (roundResponse.ok) {
            const roundData = await roundResponse.json();
            currentRound = roundData.round || "";
            document.getElementById("current-round").textContent = currentRound;
        }

        if (!leaderboardResponse.ok) {
            throw new Error("Leaderboard request failed.");
        }

        renderLeaderboard(await leaderboardResponse.json());
    } catch (error) {
        console.error("Dashboard update failed:", error);
    }
}

function renderLeaderboard(data) {
    const container = document.getElementById("leaderboard");

    if (!data.length) {
        container.innerHTML = `
            <div class="empty-state">
                <div>🏁</div>
                <h3>Quiz hasn't started yet</h3>
                <p>Scores will appear here as soon as the first round begins.</p>
            </div>`;
        return;
    }

    const topCount = currentRound.startsWith("Round 4:") ? 4 : 3;
    const topTeams = data.slice(0, topCount);
    const remainingTeams = data.slice(topCount);

    container.innerHTML = `
        <div class="top-ranking">
            ${topTeams.map((team, index) => createTeamCard(team, index, true)).join("")}
        </div>
        <div class="remaining-ranking">
            ${remainingTeams.map((team, index) => createTeamCard(team, topCount + index, false)).join("")}
        </div>`;

    document.getElementById("last-updated").textContent =
        `Updated ${new Date().toLocaleTimeString([], {
            hour: "2-digit", minute: "2-digit", second: "2-digit"
        })}`;
}

function createTeamCard(team, index, isTop) {
    const colourClass = `team-colour-${index + 1}`;
    const rankDisplay =
        index === 0 ? "🥇" :
        index === 1 ? "🥈" :
        index === 2 ? "🥉" :
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
