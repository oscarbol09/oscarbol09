const fs = require('fs');
const path = require('path');
const https = require('https');

const USERNAME = process.env.GITHUB_USERNAME || 'oscarbol09';
const TOKEN = process.env.GITHUB_TOKEN;

const headers = {
  'User-Agent': 'github-profile-stats',
  'Accept': 'application/vnd.github.v3+json',
  ...(TOKEN && { 'Authorization': `Bearer ${TOKEN}` })
};

function ghRequest(endpoint) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: endpoint,
      method: 'GET',
      headers
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        } else {
          resolve(JSON.parse(data));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function fetchAll() {
  const [user, repos] = await Promise.all([
    ghRequest(`/users/${USERNAME}`),
    ghRequest(`/users/${USERNAME}/repos?per_page=100&sort=updated&type=owner`)
  ]);
  const langStats = await computeLanguageStats(repos);
  return { user, repos, langStats };
}

async function computeLanguageStats(repos) {
  const langBytes = {};
  for (const repo of repos) {
    if (repo.fork) continue;
    try {
      const langs = await ghRequest(`/repos/${USERNAME}/${repo.name}/languages`);
      for (const [lang, bytes] of Object.entries(langs)) {
        langBytes[lang] = (langBytes[lang] || 0) + bytes;
      }
    } catch (e) {
      // ignore private repo access errors
    }
  }
  const total = Object.values(langBytes).reduce((a, b) => a + b, 0);
  return Object.entries(langBytes)
    .sort((a, b) => b[1] - a[1])
    .map(([lang, bytes]) => ({ lang, bytes, pct: ((bytes / total) * 100).toFixed(1) }));
}

function escapeXml(str) {
  return String(str).replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"').replace(/'/g, '&apos;');
}

function generateGeneralStats(user, repos) {
  const totalStars = repos.reduce((sum, r) => sum + r.stargazers_count, 0);
  const totalForks = repos.reduce((sum, r) => sum + r.forks_count, 0);
  const totalCommits = repos.reduce((sum, r) => sum + (r.commits || 0), 0); // not directly available
  const ownedRepos = repos.filter(r => !r.fork).length;

  const stats = [
    { label: 'Total Stars', value: totalStars.toLocaleString() },
    { label: 'Total Forks', value: totalForks.toLocaleString() },
    { label: 'Public Repos', value: user.public_repos.toLocaleString() },
    { label: 'Followers', value: user.followers.toLocaleString() },
    { label: 'Following', value: user.following.toLocaleString() },
    { label: 'Own Repos', value: ownedRepos.toLocaleString() }
  ];

  const width = 495;
  const height = 195;
  const cardBg = '#0d1117';
  const titleColor = '#58a6ff';
  const textColor = '#c9d1d9';
  const borderColor = '#30363d';

  let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<rect width="100%" height="100%" fill="${cardBg}" rx="6" ry="6"/>`;
  svg += `<rect x="0.5" y="0.5" width="${width-1}" height="${height-1}" fill="none" stroke="${borderColor}" stroke-width="1" rx="5.5" ry="5.5"/>`;
  svg += `<text x="20" y="30" font-family="Segoe UI, system-ui, sans-serif" font-size="14" font-weight="600" fill="${titleColor}">?? GitHub Stats</text>`;

  stats.forEach((stat, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 20 + col * 235;
    const y = 60 + row * 40;
    svg += `<text x="${x}" y="${y}" font-family="Segoe UI, system-ui, sans-serif" font-size="12" fill="${textColor}">${escapeXml(stat.label)}</text>`;
    svg += `<text x="${x}" y="${y + 20}" font-family="Segoe UI, system-ui, sans-serif" font-size="18" font-weight="600" fill="${textColor}">${escapeXml(stat.value)}</text>`;
  });

  svg += '</svg>';
  return svg;
}

function generateTopLangs(langStats) {
  const top = langStats.slice(0, 8);
  const width = 380;
  const height = 50 + top.length * 30;
  const cardBg = '#0d1117';
  const titleColor = '#58a6ff';
  const textColor = '#c9d1d9';
  const borderColor = '#30363d';
  const barBg = '#21262d';
  const barColors = ['#58a6ff', '#f78166', '#a5d6ff', '#ffa657', '#d2a8ff', '#7ee787', '#ff7b72', '#c9d1d9'];

  let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<rect width="100%" height="100%" fill="${cardBg}" rx="6" ry="6"/>`;
  svg += `<rect x="0.5" y="0.5" width="${width-1}" height="${height-1}" fill="none" stroke="${borderColor}" stroke-width="1" rx="5.5" ry="5.5"/>`;
  svg += `<text x="20" y="30" font-family="Segoe UI, system-ui, sans-serif" font-size="14" font-weight="600" fill="${titleColor}">?? Top Languages</text>`;

  top.forEach((item, i) => {
    const y = 55 + i * 30;
    const barWidth = Math.max(2, (item.pct / 100) * 260);
    svg += `<text x="20" y="${y + 14}" font-family="Segoe UI, system-ui, sans-serif" font-size="11" fill="${textColor}">${escapeXml(item.lang)}</text>`;
    svg += `<text x="120" y="${y + 14}" font-family="Segoe UI, system-ui, sans-serif" font-size="11" fill="${textColor}">${item.pct}%</text>`;
    svg += `<rect x="200" y="${y + 2}" width="260" height="16" fill="${barBg}" rx="3" ry="3"/>`;
    svg += `<rect x="200" y="${y + 2}" width="${barWidth}" height="16" fill="${barColors[i % barColors.length]}" rx="3" ry="3"/>`;
  });

  svg += '</svg>';
  return svg;
}

function generateStreak(user) {
  // Simplified streak - would need contribution graph for real data
  const width = 495;
  const height = 100;
  const cardBg = '#0d1117';
  const titleColor = '#58a6ff';
  const textColor = '#c9d1d9';
  const borderColor = '#30363d';

  let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<rect width="100%" height="100%" fill="${cardBg}" rx="6" ry="6"/>`;
  svg += `<rect x="0.5" y="0.5" width="${width-1}" height="${height-1}" fill="none" stroke="${borderColor}" stroke-width="1" rx="5.5" ry="5.5"/>`;
  svg += `<text x="20" y="30" font-family="Segoe UI, system-ui, sans-serif" font-size="14" font-weight="600" fill="${titleColor}">?? Contribution Streak</text>`;
  svg += `<text x="20" y="60" font-family="Segoe UI, system-ui, sans-serif" font-size="13" fill="${textColor}">Current streak: <tspan font-weight="600">Data from GitHub API</tspan></text>`;
  svg += `<text x="20" y="82" font-family="Segoe UI, system-ui, sans-serif" font-size="11" fill="#8b949e">Full streak data requires GraphQL contributions query</text>`;
  svg += '</svg>';
  return svg;
}

function generateTrophies(user, repos) {
  const ownedRepos = repos.filter(r => !r.fork);
  const topRepo = ownedRepos.sort((a, b) => b.stargazers_count - a.stargazers_count)[0];
  const totalStars = ownedRepos.reduce((sum, r) => sum + r.stargazers_count, 0);

  const trophies = [];
  if (totalStars >= 100) trophies.push('?? 100+ Stars');
  if (totalStars >= 500) trophies.push('?? 500+ Stars');
  if (totalStars >= 1000) trophies.push('?? 1000+ Stars');
  if (user.followers >= 50) trophies.push('?? 50+ Followers');
  if (user.followers >= 100) trophies.push('?? 100+ Followers');
  if (ownedRepos.length >= 10) trophies.push('?? 10+ Repos');
  if (ownedRepos.length >= 50) trophies.push('?? 50+ Repos');
  if (topRepo && topRepo.stargazers_count >= 50) trophies.push(`? Top: ${topRepo.name} (${topRepo.stargazers_count}?)`);

  const width = 495;
  const height = 50 + trophies.length * 28;
  const cardBg = '#0d1117';
  const titleColor = '#58a6ff';
  const textColor = '#c9d1d9';
  const borderColor = '#30363d';
  const trophyColors = ['#ffd700', '#ffdf00', '#ffe400', '#7cfc00', '#32cd32', '#228b22', '#1e90ff', '#4169e1'];

  let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<rect width="100%" height="100%" fill="${cardBg}" rx="6" ry="6"/>`;
  svg += `<rect x="0.5" y="0.5" width="${width-1}" height="${height-1}" fill="none" stroke="${borderColor}" stroke-width="1" rx="5.5" ry="5.5"/>`;
  svg += `<text x="20" y="30" font-family="Segoe UI, system-ui, sans-serif" font-size="14" font-weight="600" fill="${titleColor}">?? Trophies</text>`;

  if (trophies.length === 0) {
    svg += `<text x="20" y="60" font-family="Segoe UI, system-ui, sans-serif" font-size="12" fill="#8b949e">Keep contributing to earn trophies!</text>`;
  } else {
    trophies.forEach((trophy, i) => {
      const y = 55 + i * 28;
      svg += `<text x="20" y="${y + 14}" font-family="Segoe UI, system-ui, sans-serif" font-size="12" fill="${trophyColors[i % trophyColors.length]}">${escapeXml(trophy)}</text>`;
    });
  }

  svg += '</svg>';
  return svg;
}

async function main() {
  console.log('Fetching GitHub data...');
  const { user, repos, langStats } = await fetchAll();

  console.log('Generating SVGs...');
  const generalSvg = generateGeneralStats(user, repos);
  const langsSvg = generateTopLangs(langStats);
  const streakSvg = generateStreak(user);
  const trophiesSvg = generateTrophies(user, repos);

  const outDir = path.join(__dirname, '..', '..');
  fs.writeFileSync(path.join(outDir, 'stats-general.svg'), generalSvg);
  fs.writeFileSync(path.join(outDir, 'stats-languages.svg'), langsSvg);
  fs.writeFileSync(path.join(outDir, 'stats-streak.svg'), streakSvg);
  fs.writeFileSync(path.join(outDir, 'stats-trophies.svg'), trophiesSvg);

  console.log('SVGs written to repo root:');
  console.log('  - stats-general.svg');
  console.log('  - stats-languages.svg');
  console.log('  - stats-streak.svg');
  console.log('  - stats-trophies.svg');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
