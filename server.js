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
  const column = columns.find(c => normalise(c.title) === normalise(title));
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
    const quantity = Number(columnText(sc, 'Quantity')) || 0;
    const unitPrice = Number(columnText(sc, 'Price').replace(/[^0-9.-]/g, '')) || 0;
    const totalText = columnText(sc, 'Total').replace(/[^0-9.-]/g, '');
    const total = Number(totalText) || quantity * unitPrice;
    return {
      code: columnText(sc, 'Rates') || subitem.name,
      description: columnText(sc, 'Description') || subitem.name,
      quantity, unitPrice, total,
      taxDescription: columnText(sc, 'Tax Description')
    };
  }).filter(line => has(line.description) && line.total >= 0);
  if (!subitems.length) throw new Error('No invoiceable subitems were found.');
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
    const accent = '#DFFF00';
    doc.font('Helvetica-Bold').fontSize(25).fillColor('#080808').text('INVOICE', 40, 45);
    doc.fontSize(19).text('VANGUARD', 390, 45, { align: 'right' });
    doc.fontSize(9).text('TRAFFIC', 390, 67, { align: 'right' });
    doc.fillColor('#222').font('Helvetica').fontSize(10)
      .text(process.env.COMPANY_NAME || 'Vanguard Traffic Ltd', 390, 90, { align: 'right' })
      .text(process.env.COMPANY_ADDRESS || '66 Paul Street, London, EC2A 4NA', 390, 103, { align: 'right' })
      .text(`Company no. ${process.env.COMPANY_NUMBER || '17462744'}`, 390, 116, { align: 'right' });
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#080808').text(job.customer, 40, 120);
    doc.font('Helvetica').fontSize(10).text(job.customerEmail, 40, 139);
    doc.moveTo(40, 165).lineTo(555, 165).strokeColor('#dddddd').stroke();
    const meta = [
      ['Invoice total', money(subtotal)], ['Issue date', date(new Date())],
      ['Works reference', job.reference], ['PO number', job.purchaseOrder || '-'], ['Invoice no.', invoiceNo]
    ];
    const width = 515 / meta.length;
    meta.forEach(([label, value], i) => {
      const x = 40 + i * width;
      doc.rect(x, 180, width - 4, 42).fill('#f2f2f2');
      doc.fillColor('#111').font('Helvetica-Bold').fontSize(9).text(label, x + 4, 186, { width: width - 10 });
      doc.fontSize(11).text(value, x + 4, 201, { width: width - 10 });
    });
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#111').text('Reference', 40, 242);
    doc.font('Helvetica').fontSize(12).text(job.jobName, 40, 258);
    doc.fontSize(10).text([job.tmRequired, job.location].filter(has).join('\n'), 40, 278, { width: 500 });
    let y = 335;
    const columns = [40, 130, 330, 390, 465];
    doc.rect(40, y, 515, 24).fill('#777');
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9);
    ['Code', 'Description', 'Qty', 'Price', 'Amount'].forEach((heading, i) => doc.text(heading, columns[i] + 3, y + 7, { width: i === 1 ? 195 : 80, align: i > 1 ? 'right' : 'left' }));
    y += 24;
    doc.font('Helvetica').fillColor('#111');
    for (const line of job.lines) {
      const rowHeight = Math.max(31, doc.heightOfString(line.description, { width: 190 }) + 14);
      if (y + rowHeight > 650) { doc.addPage(); y = 60; }
      doc.rect(40, y, 515, rowHeight).strokeColor('#ddd').stroke();
      doc.fontSize(9).text(line.code, 43, y + 7, { width: 84 });
      doc.text(line.description, 133, y + 7, { width: 190 });
      doc.text(String(line.quantity), 333, y + 7, { width: 52, align: 'right' });
      doc.text(money(line.unitPrice), 393, y + 7, { width: 68, align: 'right' });
      doc.text(money(line.total), 468, y + 7, { width: 83, align: 'right' });
      y += rowHeight;
    }
    y += 25;
    doc.font('Helvetica').fontSize(11).text('Subtotal', 390, y, { width: 85 }).text(money(subtotal), 480, y, { width: 75, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(13).text('Total', 390, y + 26, { width: 85 }).text(money(subtotal), 480, y + 26, { width: 75, align: 'right' });
    doc.rect(385, y + 55, 170, 34).fill(accent);
    doc.fillColor('#111').font('Helvetica-Bold').fontSize(14).text('Invoice Total', 392, y + 65).text(money(subtotal), 470, y + 65, { width: 78, align: 'right' });
    doc.fillColor('#333').font('Helvetica').fontSize(9)
      .text(`Payment terms: ${process.env.PAYMENT_TERMS || '14 days from invoice date'}`, 40, 710)
      .text(process.env.BANK_DETAILS || 'Bank details available on request.', 40, 724, { width: 300 });
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
