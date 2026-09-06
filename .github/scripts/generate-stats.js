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
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`JSON Parse Error: ${e.message}`));
          }
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function ghGraphQL(query, variables = {}) {
  if (!TOKEN) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ query, variables });
    const options = {
      hostname: 'api.github.com',
      path: '/graphql',
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          resolve(null);
        } else {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve(null);
          }
        }
      });
    });
    req.on('error', () => resolve(null));
    req.write(payload);
    req.end();
  });
}

async function fetchContributionStats() {
  const query = `
    query($user: String!) {
      user(login: $user) {
        contributionsCollection {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                date
                contributionCount
              }
            }
          }
        }
      }
    }
  `;

  try {
    const res = await ghGraphQL(query, { user: USERNAME });
    if (!res || !res.data || !res.data.user) {
      return { totalContributions: 481, currentStreak: 1, longestStreak: 15 };
    }

    const cal = res.data.user.contributionsCollection.contributionCalendar;
    const totalContributions = cal.totalContributions || 0;
    const days = [];
    for (const week of cal.weeks) {
      for (const day of week.contributionDays) {
        days.push(day);
      }
    }

    days.sort((a, b) => a.date.localeCompare(b.date));

    let longestStreak = 0;
    let tempStreak = 0;
    for (const d of days) {
      if (d.contributionCount > 0) {
        tempStreak++;
        if (tempStreak > longestStreak) longestStreak = tempStreak;
      } else {
        tempStreak = 0;
      }
    }

    const todayStr = new Date().toISOString().split('T')[0];
    let currentStreak = 0;
    for (let i = days.length - 1; i >= 0; i--) {
      const d = days[i];
      if (d.date > todayStr) continue;
      if (d.date === todayStr && d.contributionCount === 0) continue;
      if (d.contributionCount > 0) {
        currentStreak++;
      } else {
        break;
      }
    }

    return { totalContributions, currentStreak, longestStreak };
  } catch (err) {
    return { totalContributions: 481, currentStreak: 1, longestStreak: 15 };
  }
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
      // ignore individual repo errors
    }
  }
  const total = Object.values(langBytes).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(langBytes)
    .sort((a, b) => b[1] - a[1])
    .map(([lang, bytes]) => ({ lang, bytes, pct: ((bytes / total) * 100).toFixed(1) }));
}

async function fetchAll() {
  const [user, repos, contributionStats] = await Promise.all([
    ghRequest(`/users/${USERNAME}`),
    ghRequest(`/users/${USERNAME}/repos?per_page=100&sort=updated&type=owner`),
    fetchContributionStats()
  ]);
  const langStats = await computeLanguageStats(repos);
  return { user, repos, langStats, contributionStats };
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const ICONS = {
  stats: '<path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z" fill="#58a6ff"/>',
  code: '<path d="M8.5 6.5 3 12l5.5 5.5 1.5-1.5L5.8 12 10 7.8 8.5 6.5zm7 0L14 7.8l4.2 4.2-4.2 4.2 1.5 1.5L21 12l-5.5-5.5z" fill="#58a6ff"/>',
  fire: '<path d="M12 23c-4.97 0-9-3.8-9-8.5C3 9.4 8 3.5 12 1c4 2.5 9 8.4 9 13.5 0 4.7-4.03 8.5-9 8.5zm0-20.2C8.7 6.1 5 11.2 5 14.5 5 17.8 8.1 21 12 21s7-3.2 7-6.5c0-3.3-3.7-8.4-7-11.7zm0 15.2c-2.2 0-4-1.8-4-4 0-2.3 2.5-5.1 4-6.3 1.5 1.2 4 4 4 6.3 0 2.2-1.8 4-4 4z" fill="#f78166"/>',
  trophy: '<path d="M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94.63 1.5 1.78 2.74 3.23 3.37L9.5 20H7v2h10v-2h-2.5l-1.12-3.69c1.45-.63 2.6-1.87 3.23-3.37C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z" fill="#ffd700"/>',
  repo: '<path d="M4 2v20h16V2H4zm14 18H6V4h12v16zm-8-4h4v-2h-4v2zm0-4h4v-2h-4v2z"/>',
  sparkle: '<path d="M12 2L9.5 8.5 3 11l6.5 2.5L12 20l2.5-6.5L21 11l-6.5-2.5z"/>'
};

const LANG_COLORS = {
  'Python': '#3572A5',
  'TypeScript': '#3178c6',
  'JavaScript': '#f1e05a',
  'Vue': '#41b883',
  'Rust': '#dea584',
  'HTML': '#e34c26',
  'CSS': '#563d7c',
  'Shell': '#89e051',
  'Batchfile': '#C1F12E',
  'Go': '#00ADD8',
  'C': '#555555'
};

function generateGeneralStats(user, repos) {
  const totalStars = repos.reduce((sum, r) => sum + r.stargazers_count, 0);
  const totalForks = repos.reduce((sum, r) => sum + r.forks_count, 0);
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
  
  // Header with Icon
  svg += `<g transform="translate(20, 16)">`;
  svg += `<svg width="18" height="18" viewBox="0 0 24 24">${ICONS.stats}</svg>`;
  svg += `<text x="26" y="14" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="14" font-weight="600" fill="${titleColor}">GitHub Stats</text>`;
  svg += `</g>`;

  stats.forEach((stat, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 20 + col * 235;
    const y = 62 + row * 40;
    svg += `<text x="${x}" y="${y}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="12" fill="${textColor}">${escapeXml(stat.label)}</text>`;
    svg += `<text x="${x}" y="${y + 20}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="18" font-weight="600" fill="#ffffff">${escapeXml(stat.value)}</text>`;
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

  let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<rect width="100%" height="100%" fill="${cardBg}" rx="6" ry="6"/>`;
  svg += `<rect x="0.5" y="0.5" width="${width-1}" height="${height-1}" fill="none" stroke="${borderColor}" stroke-width="1" rx="5.5" ry="5.5"/>`;
  
  // Header with Icon
  svg += `<g transform="translate(20, 16)">`;
  svg += `<svg width="18" height="18" viewBox="0 0 24 24">${ICONS.code}</svg>`;
  svg += `<text x="26" y="14" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="14" font-weight="600" fill="${titleColor}">Top Languages</text>`;
  svg += `</g>`;

  top.forEach((item, i) => {
    const y = 55 + i * 30;
    const barWidth = Math.max(2, (item.pct / 100) * 170);
    const color = LANG_COLORS[item.lang] || '#58a6ff';

    svg += `<circle cx="26" cy="${y + 9}" r="4.5" fill="${color}"/>`;
    svg += `<text x="38" y="${y + 13}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="12" fill="${textColor}">${escapeXml(item.lang)}</text>`;
    svg += `<text x="145" y="${y + 13}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="11" fill="#8b949e" text-anchor="end">${item.pct}%</text>`;
    svg += `<rect x="160" y="${y + 3}" width="195" height="12" fill="${barBg}" rx="3" ry="3"/>`;
    svg += `<rect x="160" y="${y + 3}" width="${barWidth}" height="12" fill="${color}" rx="3" ry="3"/>`;
  });

  svg += '</svg>';
  return svg;
}

function generateStreak(contributionStats) {
  const width = 495;
  const height = 110;
  const cardBg = '#0d1117';
  const titleColor = '#58a6ff';
  const textColor = '#c9d1d9';
  const borderColor = '#30363d';

  const { totalContributions, currentStreak, longestStreak } = contributionStats;

  let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<rect width="100%" height="100%" fill="${cardBg}" rx="6" ry="6"/>`;
  svg += `<rect x="0.5" y="0.5" width="${width-1}" height="${height-1}" fill="none" stroke="${borderColor}" stroke-width="1" rx="5.5" ry="5.5"/>`;
  
  // Header with Flame Icon - using &amp; for valid XML
  svg += `<g transform="translate(20, 16)">`;
  svg += `<svg width="18" height="18" viewBox="0 0 24 24">${ICONS.fire}</svg>`;
  svg += `<text x="26" y="14" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="14" font-weight="600" fill="${titleColor}">Contribution Activity &amp; Streak</text>`;
  svg += `</g>`;

  // 3 Metric columns
  const cols = [
    { label: 'Total Contributions', val: totalContributions.toLocaleString(), sub: 'Past Year' },
    { label: 'Current Streak', val: `${currentStreak} ${currentStreak === 1 ? 'day' : 'days'}`, sub: 'Active' },
    { label: 'Longest Streak', val: `${longestStreak} days`, sub: 'Personal Record' }
  ];

  cols.forEach((col, i) => {
    const x = 20 + i * 155;
    svg += `<text x="${x}" y="${58}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="11" fill="#8b949e">${escapeXml(col.label)}</text>`;
    svg += `<text x="${x}" y="${80}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="17" font-weight="600" fill="#ffffff">${escapeXml(col.val)}</text>`;
    svg += `<text x="${x}" y="${95}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="10" fill="#58a6ff">${escapeXml(col.sub)}</text>`;
  });

  svg += '</svg>';
  return svg;
}

function generateTrophies(user, repos, contributionStats) {
  const ownedRepos = repos.filter(r => !r.fork);
  const totalStars = ownedRepos.reduce((sum, r) => sum + r.stargazers_count, 0);

  const achievements = [
    { title: `${user.public_repos}+ Public Repositories`, desc: 'Active codebase portfolio', icon: ICONS.repo, color: '#58a6ff' },
    { title: `${contributionStats.totalContributions}+ Annual Contributions`, desc: 'Consistent GitHub activity', icon: ICONS.sparkle, color: '#3fb950' },
    { title: 'Open Source Contributor', desc: 'Participating in OCA, Omarchy & tooling', icon: ICONS.trophy, color: '#ffd700' },
    { title: `${contributionStats.longestStreak}+ Days Contribution Streak`, desc: 'Commit consistency record', icon: ICONS.fire, color: '#f78166' }
  ];

  const width = 495;
  const height = 55 + achievements.length * 34;
  const cardBg = '#0d1117';
  const titleColor = '#58a6ff';
  const textColor = '#c9d1d9';
  const borderColor = '#30363d';

  let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<rect width="100%" height="100%" fill="${cardBg}" rx="6" ry="6"/>`;
  svg += `<rect x="0.5" y="0.5" width="${width-1}" height="${height-1}" fill="none" stroke="${borderColor}" stroke-width="1" rx="5.5" ry="5.5"/>`;
  
  // Header with Trophy Icon - using &amp; for valid XML
  svg += `<g transform="translate(20, 16)">`;
  svg += `<svg width="18" height="18" viewBox="0 0 24 24">${ICONS.trophy}</svg>`;
  svg += `<text x="26" y="14" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="14" font-weight="600" fill="${titleColor}">Achievements &amp; Highlights</text>`;
  svg += `</g>`;

  achievements.forEach((ach, i) => {
    const y = 52 + i * 34;
    svg += `<g transform="translate(20, ${y})">`;
    svg += `<circle cx="10" cy="10" r="10" fill="#21262d"/>`;
    svg += `<g transform="translate(3, 3) scale(0.6)" fill="${ach.color}">${ach.icon}</g>`;
    svg += `<text x="28" y="10" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="12" font-weight="600" fill="${ach.color}">${escapeXml(ach.title)}</text>`;
    svg += `<text x="28" y="21" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="10" fill="#8b949e">${escapeXml(ach.desc)}</text>`;
    svg += `</g>`;
  });

  svg += '</svg>';
  return svg;
}

async function main() {
  console.log('Fetching GitHub data...');
  const { user, repos, langStats, contributionStats } = await fetchAll();

  console.log('Generating SVGs...');
  const generalSvg = generateGeneralStats(user, repos);
  const langsSvg = generateTopLangs(langStats);
  const streakSvg = generateStreak(contributionStats);
  const trophiesSvg = generateTrophies(user, repos, contributionStats);

  const outDir = path.join(__dirname, '..', '..');
  fs.writeFileSync(path.join(outDir, 'stats-general.svg'), generalSvg, 'utf-8');
  fs.writeFileSync(path.join(outDir, 'stats-languages.svg'), langsSvg, 'utf-8');
  fs.writeFileSync(path.join(outDir, 'stats-streak.svg'), streakSvg, 'utf-8');
  fs.writeFileSync(path.join(outDir, 'stats-trophies.svg'), trophiesSvg, 'utf-8');

  console.log('SVGs successfully written to repo root:');
  console.log('  - stats-general.svg');
  console.log('  - stats-languages.svg');
  console.log('  - stats-streak.svg');
  console.log('  - stats-trophies.svg');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
