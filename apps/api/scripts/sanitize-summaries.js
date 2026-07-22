const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function unescapeJsonString(s) {
  try {
    return JSON.parse(`"${s}"`);
  } catch {
    return s.replace(/\\n/g, '\n').replace(/\\"/g, '"');
  }
}

function extractField(raw, key) {
  if (!raw) return null;
  const re = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`);
  const m = raw.match(re);
  return m?.[1] ? unescapeJsonString(m[1]) : null;
}

function looksLikeGarbage(text) {
  if (!text) return true;
  return (
    /here'?s a thinking process/i.test(text) ||
    /analyze user input/i.test(text) ||
    /required keys/i.test(text) ||
    /output format/i.test(text) ||
    /<think\b/i.test(text)
  );
}

(async () => {
  const rows = await prisma.meetingSummary.findMany();
  let n = 0;
  for (const row of rows) {
    if (!looksLikeGarbage(row.executive) && !looksLikeGarbage(row.detailed)) continue;

    const blob = `${row.executive}\n${row.detailed}`;
    let executive = extractField(blob, 'executive');
    let detailed = extractField(blob, 'detailed');

    // Fallback: if detailed is truncated mid-string, take everything after "detailed": "
    if (!detailed && /"detailed"\s*:\s*"/.test(blob)) {
      const idx = blob.search(/"detailed"\s*:\s*"/);
      if (idx >= 0) {
        const after = blob.slice(idx).replace(/^"detailed"\s*:\s*"/, '');
        detailed = unescapeJsonString(after.replace(/"\s*,?\s*$/, ''));
      }
    }

    if (!executive) {
      console.log('skip (no executive)', row.meetingId);
      continue;
    }
    if (!detailed) detailed = executive;

    await prisma.meetingSummary.update({
      where: { id: row.id },
      data: { executive, detailed },
    });
    n += 1;
    console.log('fixed', row.meetingId);
    console.log(' ', executive.slice(0, 180));
  }
  console.log('updated', n);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
