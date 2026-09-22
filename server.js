import 'dotenv/config';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import axios from 'axios';
import express from 'express';
import FormData from 'form-data';
import PDFDocument from 'pdfkit';

const app = express();
app.use(express.json({ limit: '1mb' }));

const required = ['MONDAY_API_TOKEN', 'WEBHOOK_SECRET', 'MONDAY_FILES_COLUMN_ID'];
const mondayApi = axios.create({
  baseURL: 'https://api.monday.com/v2',
  headers: { Authorization: process.env.MONDAY_API_TOKEN || '' },
  timeout: 30000
});

const normalise = value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
const money = value => `£${Number(value || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = value => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(value);

function columnText(columns, title, fallback = '') {
  const aliases = (Array.isArray(title) ? title : [title]).map(normalise);
  const configuredId = process.env[`SUBITEM_${aliases[0].toUpperCase()}_COLUMN_ID`];
  const column = columns.find(c => configuredId && c.id === configuredId)
    || columns.find(c => aliases.includes(normalise(c.title)))
    || columns.find(c => aliases.some(alias => normalise(c.title).includes(alias)));
  return (column?.text || fallback).trim();
}

function has(value) { return value && value.toLowerCase() !== 'null'; }

async function mondayQuery(query, variables) {
  const { data } = await mondayApi.post('', { query, variables });
  if (data.errors?.length) throw new Error(data.errors.map(e => e.message).join('; '));
  return data.data;
}

async function getJob(itemId) {
  const query = `query ($ids: [ID!]) {
    items(ids: $ids) {
      id name
      column_values { id text value }
      subitems {
        id name
        board { columns { id title } }
        column_values { id text value }
      }
    }
    boards(ids: $ids) { columns { id title } }
  }`;
  const data = await mondayQuery(query, { ids: [String(itemId)] });
  const item = data.items?.[0];
  if (!item) throw new Error('Monday item was not found.');
  const addTitles = (values, columns) => {
    const titles = new Map((columns || []).map(column => [column.id, column.title]));
    return values.map(value => ({ ...value, title: titles.get(value.id) || value.id }));
  };
  const c = addTitles(item.column_values, data.boards?.[0]?.columns);
  const subitems = item.subitems.map(subitem => {
    const sc = addTitles(subitem.column_values, subitem.board?.columns);
    const quantity = Number(columnText(sc, ['Quantity', 'Qty'])) || 0;
    const unitPrice = Number(columnText(sc, ['Price', 'Unit Price', 'Rate']).replace(/[^0-9.-]/g, '')) || 0;
    const totalText = columnText(sc, ['Total', 'Amount']).replace(/[^0-9.-]/g, '');
    const total = Number(totalText) || quantity * unitPrice;
    return {
      code: columnText(sc, ['Rates', 'Rate', 'Code']) || subitem.name,
      description: columnText(sc, ['Description', 'Details']) || subitem.name,
      quantity, unitPrice, total,
      taxDescription: columnText(sc, ['Tax Description', 'Tax'])
    };
  }).filter(line => has(line.description) && line.total >= 0);
  if (!subitems.length) throw new Error('No invoiceable subitems were found.');
  if (subitems.every(line => line.total === 0)) {
    throw new Error('All invoice line totals are £0. Check that each subitem has Quantity and Price/Total populated, then confirm their column titles are Quantity, Price and Total.');
  }
  const customers = c.filter(x => normalise(x.title) === 'customer').map(x => x.text).filter(has);
  return {
    itemId: item.id,
    jobName: item.name,
    reference: columnText(c, 'Our Reference') || item.id,
    customer: customers.at(-1) || 'Customer to be confirmed',
    customerEmail: columnText(c, 'Customer Email'),
    purchaseOrder: columnText(c, 'Customer PO'),
    location: columnText(c, 'Location'),
    tmRequired: columnText(c, 'TM Required'),
    cad: columnText(c, 'CAD'),
    permits: columnText(c, ['Permit Support', 'Permits']),
    delivery: columnText(c, 'Delivery'),
    lines: subitems
  };
}

function renderInvoice(job) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const subtotal = job.lines.reduce((sum, line) => sum + line.total, 0);
    const invoiceNo = process.env.INVOICE_PREFIX ? `${process.env.INVOICE_PREFIX}-${job.reference}` : job.reference;
    const accent = '#b9ff3e';
    const dark = '#111111';
    const grey = '#eeeeee';
    const pageRight = 555;
    const companyAddress = process.env.COMPANY_ADDRESS || '66 Paul Street, London, England, United Kingdom, EC2A 4NA';
    const invoiceLabel = 'Invoice';

    // Header, matched to the approved Vanguard document format.
    doc.font('Helvetica-Bold').fontSize(22).fillColor('#333333').text(invoiceLabel, 40, 47);
    doc.font('Helvetica-Bold').fontSize(24).fillColor('#000').text('VANGUARD', 378, 54, { width: 165, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(8).characterSpacing(4).text('TRAFFIC SERVICES', 378, 80, { width: 165, align: 'right' }).characterSpacing(0);
    [0, 1, 2].forEach((i) => doc.circle(548, 58 + i * 9, 4.2).fill(['#ef2b2d', '#f6ca16', '#20a65a'][i]));
    doc.font('Helvetica-Bold').fontSize(10).fillColor(dark)
      .text(process.env.COMPANY_NAME || 'Vanguard Traffic LTD', 380, 101, { width: 175, align: 'right' });
    doc.font('Helvetica').fontSize(9).text(companyAddress, 380, 114, { width: 175, align: 'right' });
    doc.font('Helvetica-Bold').text(`Company number ${process.env.COMPANY_NUMBER || '17462744'}`, 380, 151, { width: 175, align: 'right' });

    doc.font('Helvetica-Bold').fontSize(11).fillColor(dark).text(job.customer, 40, 102, { width: 300 });
    doc.font('Helvetica').fontSize(10).text(job.customerEmail, 40, 119, { width: 300 });
    doc.fontSize(10).text(job.location || '', 40, 136, { width: 300 });
    const meta = [
      ['Invoice total', money(subtotal)], ['Issue date', date(new Date())],
      ['Works reference', job.reference], ['PO number', job.purchaseOrder || '-'], ['Invoice no.', invoiceNo]
    ];
    const width = 515 / meta.length;
    meta.forEach(([label, value], i) => {
      const x = 40 + i * width;
      doc.rect(x, 180, width, 17).fill(grey);
      doc.fillColor(dark).font('Helvetica-Bold').fontSize(9).text(label, x + 2, 182, { width: width - 5 });
      doc.fontSize(11).text(value, x + 2, 199, { width: width - 5 });
    });
    doc.rect(40, 239, 515, 16).fill(grey);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(dark).text('Reference', 42, 242);
    doc.font('Helvetica').fontSize(11).text(job.jobName, 40, 260);
    doc.fontSize(10).text(job.tmRequired || '', 40, 277, { width: 500 });

    const serviceFlags = [
      ['Survey', false], ['CAD', /yes|complete|done|true/i.test(job.cad || '')],
      ['Permits', /yes|complete|done|true/i.test(job.permits || '')], ['Delivery', /yes|complete|done|true/i.test(job.delivery || '')]
    ];
    doc.rect(40, 316, 515, 16).fill(grey);
    serviceFlags.forEach(([label, enabled], i) => {
      const x = 40 + i * 128.75;
      doc.font('Helvetica-Bold').fontSize(10).fillColor(dark).text(label, x, 318, { width: 128.75, align: 'center' });
      doc.font('Helvetica-Bold').fontSize(14).text(enabled ? '✓' : '✕', x, 334, { width: 128.75, align: 'center' });
    });

    let y = 350;
    const columns = [40, 122, 298, 388, 452, 510];
    doc.rect(40, y, 515, 20).fill('#888888');
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9);
    ['Code', 'Description', 'Quantity', 'Price', 'Tax', 'Amount'].forEach((heading, i) => doc.text(heading, columns[i] + 2, y + 5, { width: i === 1 ? 172 : (i === 2 ? 88 : 56), align: i > 1 ? 'right' : 'left' }));
    y += 20;
    doc.font('Helvetica').fillColor('#111');
    for (const line of job.lines) {
      const rowHeight = Math.max(38, doc.heightOfString(line.description, { width: 170 }) + 14);
      if (y + rowHeight > 590) { doc.addPage(); y = 60; }
      doc.rect(40, y, 515, rowHeight).strokeColor('#ddd').stroke();
      doc.fontSize(9).text(line.code, 42, y + 7, { width: 76 });
      doc.text(line.description, 124, y + 7, { width: 170 });
      doc.text(String(line.quantity), 300, y + 7, { width: 82, align: 'right' });
      doc.text(money(line.unitPrice), 390, y + 7, { width: 58, align: 'right' });
      doc.text(line.taxDescription || '20% *', 454, y + 7, { width: 52, align: 'right' });
      doc.text(money(line.total), 512, y + 7, { width: 40, align: 'right' });
      y += rowHeight;
    }
    y += 20;
    const totalsX = 365;
    doc.font('Helvetica').fontSize(10).text('Subtotal', totalsX, y, { width: 125 }).text(money(subtotal), 495, y, { width: 58, align: 'right' });
    doc.text('Total Domestic Reverse\nCharge @ 20% (VAT on\nIncome)', totalsX, y + 20, { width: 125 }).text('£0.00', 495, y + 40, { width: 58, align: 'right' });
    doc.moveTo(totalsX, y + 69).lineTo(pageRight, y + 69).strokeColor(dark).stroke();
    doc.font('Helvetica-Bold').fontSize(11).text('Total', totalsX, y + 82).text(money(subtotal), 495, y + 82, { width: 58, align: 'right' });
    doc.moveTo(totalsX, y + 104).lineTo(pageRight, y + 104).strokeColor(dark).stroke();
    doc.rect(totalsX, y + 118, 190, 26).fill(accent);
    doc.fillColor(dark).font('Helvetica-Bold').fontSize(12).text('Invoice Total', totalsX + 3, y + 125).text(money(subtotal), 495, y + 125, { width: 58, align: 'right' });
    doc.fillColor('#555').font('Helvetica-Oblique').fontSize(8.5)
      .text('* Domestic reverse charge (DRC) applies to items marked.\nCustomers need to account for VAT on these items to HMRC, at\n20% of the rates shown.', 40, y + 30, { width: 270 });
    doc.fillColor(dark).font('Helvetica').fontSize(8.5)
      .text(process.env.BANK_DETAILS || 'Bank: Tide Business Banking\nAccount Number: 33763868\nSort Code: 04-06-05\nAccount Name: Vanguard Traffic Services LTD', 40, y + 112, { width: 270 });
    doc.end();
  });
}

async function uploadPdf(itemId, filename, buffer) {
  const form = new FormData();
  form.append('query', `mutation ($file: File!) { add_file_to_column(item_id: ${itemId}, column_id: "${process.env.MONDAY_FILES_COLUMN_ID}", file: $file) { id } }`);
  form.append('map', JSON.stringify({ file: 'variables.file' }));
  form.append('variables', JSON.stringify({ file: null }));
  form.append('file', Readable.from(buffer), { filename, contentType: 'application/pdf' });
  const { data } = await axios.post('https://api.monday.com/v2/file', form, { headers: { Authorization: process.env.MONDAY_API_TOKEN, ...form.getHeaders() }, timeout: 60000 });
  if (data.errors?.length) throw new Error(data.errors.map(e => e.message).join('; '));
}

function authorised(req) {
  const actual = String(req.query.secret || req.get('x-webhook-secret') || '');
  const expected = String(process.env.WEBHOOK_SECRET || '');
  return actual.length === expected.length && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

app.get('/health', (_req, res) => res.json({ ok: true, service: 'vanguard-monday-invoice-api' }));
app.post('/monday/invoice', async (req, res) => {
  if (req.body?.challenge) return res.json({ challenge: req.body.challenge });
  if (!authorised(req)) return res.status(401).json({ error: 'Unauthorised webhook.' });
  const itemId = req.body?.itemId || req.body?.pulseId || req.body?.event?.pulseId || req.body?.event?.itemId;
  if (!itemId) return res.status(400).json({ error: 'Missing Monday item ID.' });
  try {
    const missing = required.filter(key => !process.env[key]);
    if (missing.length) throw new Error(`Missing configuration: ${missing.join(', ')}`);
    const job = await getJob(itemId);
    const pdf = await renderInvoice(job);
    const filename = `${job.reference} Invoice.pdf`;
    await uploadPdf(job.itemId, filename, pdf);
    res.json({ ok: true, filename, total: job.lines.reduce((sum, line) => sum + line.total, 0) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Invoice generation failed.' });
  }
});

app.listen(process.env.PORT || 10000, () => console.log('Invoice API running'));
