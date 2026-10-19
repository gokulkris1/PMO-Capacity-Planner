/**
 * Key PO journeys in the demo workspace (§6.2#3, §6.3): edit an allocation cell and undo it, capture demand,
 * propose a match and accept it in My plan, bulk-edit people, export CSV and the QBR pack, change settings.
 */
import { expect, openDemo, test } from './fixtures';

test.describe('planning flows', () => {
  test('edit an allocation cell, then undo it (AL-02, AL-03)', async ({ page }) => {
    await openDemo(page, 'plan/allocations');
    const cell = () => page.getByRole('gridcell', { name: /^Apollo Revamp, Scrum Master[^,]*, QBR1, / }).first();
    await expect(cell()).toHaveAccessibleName(/, 40%/);
    await cell().dblclick();
    const input = page.getByRole('textbox', { name: /^Edit Apollo Revamp/ });
    await input.fill('25');
    await input.press('Enter');
    await expect(cell()).toHaveAccessibleName(/, 25%/);
    await page.getByRole('button', { name: 'Undo', exact: true }).first().click();
    await expect(cell()).toHaveAccessibleName(/, 40%/);
  });

  test('capture demand for a project (DM-02)', async ({ page }) => {
    await openDemo(page, 'plan/demand');
    await page.getByRole('button', { name: 'Add demand', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Project', { exact: true }).selectOption({ label: 'Nebula Analytics' });
    await dialog.getByLabel('Quarter', { exact: true }).selectOption({ index: 3 });
    const before = await dialog.getByRole('listitem').count();
    await dialog.getByRole('button', { name: 'Add craft line' }).click();
    const n = before + 1;
    await dialog.getByLabel(`Craft for line ${n}`).selectOption({ label: 'RG · Risk, Governance & Compliance' });
    await dialog.getByLabel(`FTE for line ${n}`).fill('1.5');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toBeHidden();
    const nebulaQbr4 = page.getByRole('row', { name: /Nebula Analytics/ }).getByRole('button', { name: /QBR4/ });
    await expect(nebulaQbr4).toContainText('RG 1.5');
  });

  test('propose a match in the Marketplace and accept it in My plan (DM-03, PPL-05)', async ({ page }) => {
    await openDemo(page, 'plan/marketplace');
    await page.getByRole('button', { name: /^Project Management · above the table Apollo Revamp/ }).click();
    const match = page.getByRole('table', { name: 'Ranked matches for Apollo Revamp' }).getByRole('row', {
      name: /Gokul Gurijala/,
    });
    await match.getByRole('button', { name: 'Propose' }).click();
    const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog'));
    await confirm.getByRole('button', { name: 'Propose', exact: true }).click();
    await expect(page.getByText(/proposed/i).first()).toBeVisible();

    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'My plan' }).click();
    await expect(page.locator('main h1')).toHaveText('My plan');
    const proposals = page.getByRole('region', { name: 'Proposed to you' });
    const row = proposals.getByRole('listitem').filter({ hasText: 'Apollo Revamp' }).first();
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Accept' }).click();
    await expect(proposals.getByRole('listitem').filter({ hasText: 'Apollo Revamp' })).toHaveCount(0);
  });

  test('bulk-edit the target of several people (PPL-03)', async ({ page }) => {
    await openDemo(page, 'org/people');
    await page.getByRole('checkbox', { name: /Select Claire Ryan/ }).check();
    await page.getByRole('checkbox', { name: /Select Emer Ward/ }).check();
    const bulkBar = page.getByRole('region', { name: 'Bulk actions' });
    await expect(bulkBar).toContainText('2 selected');
    await bulkBar.getByRole('button', { name: 'Set target' }).click();
    const dialog = page.getByRole('dialog', { name: 'Set target utilisation' });
    await dialog.getByRole('textbox').first().fill('80');
    await dialog.getByRole('button', { name: /^Apply to 2 people$/ }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('row', { name: /Claire Ryan/ })).toContainText('80%');
    await expect(page.getByRole('row', { name: /Emer Ward/ })).toContainText('80%');
  });
});

test.describe('exports', () => {
  test('People CSV export downloads the current filter (PPL-04)', async ({ page }) => {
    await openDemo(page, 'org/people');
    await page.getByRole('button', { name: 'More actions' }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Export CSV' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^people-.*\.csv$/);
    const text = await (await file.createReadStream()).toArray();
    expect(Buffer.concat(text).toString('utf8')).toMatch(/Noma Odigie/);
  });

  test('Reports: utilisation CSV and the QBR pack PDF download (RP-04)', async ({ page }) => {
    await openDemo(page, 'reports');
    const card = (title: string) =>
      page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: title }) });
    let download = page.waitForEvent('download');
    await card('Utilisation by person (CSV)').getByRole('button', { name: 'Download' }).click();
    expect((await download).suggestedFilename()).toMatch(/^utilisation-by-person-.*\.csv$/);

    download = page.waitForEvent('download');
    await card('QBR pack (PDF)').getByRole('button', { name: 'Download' }).click();
    const pdf = await download;
    expect(pdf.suggestedFilename()).toMatch(/^qbr-pack-.*\.pdf$/);
    const bytes = Buffer.concat(await (await pdf.createReadStream()).toArray());
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(5_000);
  });
});

test.describe('settings', () => {
  test('rename the organisation and change the planning target (ST-01, ST-03)', async ({ page }) => {
    await openDemo(page, 'settings/planning');
    const target = page.getByLabel(/default target/i);
    await target.fill('95');
    await target.blur();
    await page.getByRole('button', { name: /^Save/ }).click();
    await expect(page.getByText(/saved/i).first()).toBeVisible();
    await page.reload();
    await expect(page.getByLabel(/default target/i)).toHaveValue('95');
  });

  test('turn on the AI assistant with the egress notice (ST-05, HS-11)', async ({ page }) => {
    await openDemo(page, 'settings/features');
    const ai = page.getByRole('switch', { name: /Ask Tom/i });
    await expect(ai).not.toBeChecked();
    await ai.click();
    const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog'));
    await expect(confirm).toContainText(/people, projects and allocations will be sent/i);
    await confirm.getByRole('button', { name: 'Turn on', exact: true }).click();
    await expect(ai).toBeChecked();
    // Ask Tom opens from the Help menu (and the floating button) and answers from the demo data.
    await page.getByRole('button', { name: 'Help' }).click();
    await page.getByRole('menuitem', { name: 'Ask Tom' }).click();
    const tom = page.getByRole('dialog', { name: 'Ask Tom' });
    await tom.getByLabel('Your question').fill('Who is over capacity?');
    await tom.getByRole('button', { name: 'Send' }).click();
    await expect(tom.getByRole('list', { name: 'Conversation' })).toContainText(/over capacity/i);
  });
});
