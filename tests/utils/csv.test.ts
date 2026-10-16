import { csvFileName, escapeCsvCell, parseCsv, parseCsvRecords, toCsv, toCsvRows } from '../../utils/csv';
import { parsePeopleCsv, peopleCsvTemplate, peopleToCsv, PEOPLE_CSV_HEADERS } from '../../utils/csvPeople';
import { demoSnapshot } from './fixtures';

describe('csv', () => {
  it('escapes quotes, commas and newlines and writes CRLF', () => {
    expect(toCsvRows([['a,b', 'say "hi"', 'two\nlines', 3, null, true]], ['x', 'y', 'z', 'n', 'e', 'b'])).toBe(
      'x,y,z,n,e,b\r\n"a,b","say ""hi""","two\nlines",3,,true\r\n',
    );
  });

  it('neutralises spreadsheet formulas in text cells but keeps numbers', () => {
    expect(escapeCsvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(escapeCsvCell('+1')).toBe("'+1");
    expect(escapeCsvCell('@SUM')).toBe("'@SUM");
    expect(escapeCsvCell(-0.3)).toBe('-0.3');
    expect(escapeCsvCell(Number.NaN)).toBe('');
  });

  it('builds CSV from objects and columns', () => {
    expect(
      toCsv(
        [{ a: 1, b: 'x' }],
        [
          { header: 'A', value: (r) => r.a },
          { header: 'B', value: (r) => r.b },
        ],
      ),
    ).toBe('A,B\r\n1,x\r\n');
  });

  it('parses quoted fields, escaped quotes, embedded newlines, CRLF and a BOM', () => {
    const text = '\uFEFFname,note\r\n"Ann, PM","He said ""ok""\nthen left"\r\nBob,\n\n';
    expect(parseCsv(text)).toEqual([
      ['name', 'note'],
      ['Ann, PM', 'He said "ok"\nthen left'],
      ['Bob', ''],
    ]);
    expect(parseCsv(toCsvRows([['a"b', 'c,d']]))).toEqual([['a"b', 'c,d']]);
  });

  it('normalises headers when parsing records', () => {
    expect(parseCsvRecords('Job Title,target-pct\r\nPM, 90 \r\n')).toEqual({
      headers: ['job_title', 'target_pct'],
      records: [{ job_title: 'PM', target_pct: '90' }],
    });
  });

  it('names export files {page}-{yyyy-mm-dd}.csv (DS-04#AC7)', () => {
    expect(csvFileName('People & crafts', '2026-10-16T10:00:00Z')).toBe('people-crafts-2026-10-16.csv');
  });
});

describe('people CSV (PPL-04)', () => {
  it('template has the agreed columns and an example row', () => {
    const [header, example] = parseCsv(peopleCsvTemplate());
    expect(header).toEqual([...PEOPLE_CSV_HEADERS]);
    expect(example[PEOPLE_CSV_HEADERS.indexOf('below_crafts')]).toBe('SM:3:50|BA:2:30');
  });

  it('reports invalid rows with reasons and keeps valid rows (PPL-04#AC2)', async () => {
    const s = await demoSnapshot();
    const csv = [
      PEOPLE_CSV_HEADERS.join(','),
      'Alex Murphy,alex@example.com,PM,Permanent,Dublin,Project Management,Delivery,Digital,90,PM,SM:3:50|BA:2,Jira|SAFe',
      'Bad Row,bad@example.com,PM,Permanent,,,,,200,XX,,',
      'Tom Hayes,tom.hayes@company.ie,Chapter Lead,permanent,,,,,100,PGM,RG:3:30,',
      ',,,,,,,,,,,',
      'Dup,alex@example.com,,,,,,,,,,',
      'Self Below,s@example.com,,Contract,,,,,,PM,PM:2:20,',
    ].join('\n');
    const r = parsePeopleCsv(csv, s);
    expect(r.headerErrors).toEqual([]);
    expect(r.rows.map((x) => [x.row, x.action, x.errors])).toEqual([
      [1, 'create', []],
      [2, null, ['Target must be 0–150', "Unknown craft 'XX'"]],
      [3, 'update', []],
      [4, null, ['Name is required']],
      [5, null, ['Same email as row 1']],
      [6, null, ['PM is already their above-the-table craft']],
    ]);
    expect(r.validRows).toHaveLength(2);
    expect(r.invalidCount).toBe(4);
    expect(r.validRows[0]).toEqual({
      name: 'Alex Murphy',
      email: 'alex@example.com',
      jobTitle: 'PM',
      type: 'Permanent',
      location: 'Dublin',
      chapter: 'Project Management',
      team: 'Delivery',
      homeTribe: 'Digital',
      targetPct: 90,
      aboveCraft: 'project-mgmt',
      belowCrafts: [
        { craftId: 'scrum-master', proficiency: 3, maxPct: 50 },
        { craftId: 'business-analysis', proficiency: 2, maxPct: 40 },
      ],
      skills: ['Jira', 'SAFe'],
    });
  });

  it('unknown chapters, teams and tribes are errors unless "create missing" is ticked (PPL-04#AC3)', async () => {
    const s = await demoSnapshot();
    const csv = `${PEOPLE_CSV_HEADERS.join(',')}\nNew Person,,,,,Service Design,Team X,Retail,,,,`;
    expect(parsePeopleCsv(csv, s).rows[0].errors).toEqual([
      "Unknown chapter 'Service Design'",
      "Unknown team 'Team X'",
      "Unknown home tribe 'Retail'",
    ]);
    const ok = parsePeopleCsv(csv, s, { createMissingStructure: true });
    expect(ok.rows[0].errors).toEqual([]);
    expect(ok.rows[0].creates).toEqual(["chapter 'Service Design'", "team 'Team X'", "home tribe 'Retail'"]);
  });

  it('flags a file without a name column', async () => {
    const s = await demoSnapshot();
    const r = parsePeopleCsv('email,foo\na@b.co,1', s);
    expect(r.headerErrors).toEqual([
      "The file needs a 'name' column. Use the template.",
      'Unknown columns ignored: foo',
    ]);
    expect(r.validRows).toEqual([]);
  });

  it('exports the same columns and round-trips through the parser (PPL-04#AC4)', async () => {
    const s = await demoSnapshot();
    const text = peopleToCsv(s.people, s);
    const [header, tom] = parseCsv(text);
    expect(header).toEqual([...PEOPLE_CSV_HEADERS]);
    expect(tom).toEqual([
      'Tom Hayes',
      'tom.hayes@company.ie',
      'Chapter Lead – Business Delivery',
      'Permanent',
      'Dublin',
      'Programme Management',
      'Programme Management',
      'Payments',
      '100',
      'PGM',
      'RG:3:30|DP:2:20',
      'Stakeholder Mgmt;Benefits Tracking',
    ]);
    const back = parsePeopleCsv(text, s);
    expect(back.invalidCount).toBe(0);
    expect(back.rows.every((r) => r.action === 'update')).toBe(true);
  });
});
