// Printable, letter-sized PDF generator for invoices and estimates.
//
// Older clients like to print and file paper copies, so we render a clean
// 8.5 × 11 layout that mirrors the in-app preview's brand colors (navy/orange)
// but with larger fonts, more whitespace, and a structure that flows nicely on
// a real piece of paper instead of a phone screen.
//
// We draw with jsPDF directly (vector text + filled rects) instead of html2canvas
// so the file stays small, the text is sharp, and the bundle hit is minimal.
//
// Returns a Blob (application/pdf). The caller turns it into a base64 string
// for the email attachment, or a download URL for the local print path.

// jspdf ships its default export under different names depending on the
// build target (ESM in the browser via Vite, CJS interop in Node). Pull
// in everything and pick whichever one is callable so this file works in
// both runtimes — the dev environment occasionally smoke-tests it under
// node.
import * as jsPDFModule from "jspdf";
import { resolveBillTo } from "./billTo.js";
const jsPDF = jsPDFModule.jsPDF || jsPDFModule.default || jsPDFModule;

const NAVY = "#0a1628";
const NAVY2 = "#0f2040";
const ORANGE = "#E8622A";
const TEXT_DARK = "#222222";
const TEXT_MID = "#555555";
const TEXT_LIGHT = "#888888";
const RULE = "#dde2ee";
const ROW_ALT = "#f8f9fc";

// Letter size in points (1pt = 1/72in). 8.5" × 11" = 612 × 792.
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 48; // 2/3"

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtMoney(n) {
  const v = Number(n) || 0;
  return "$" + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function fmtDate(d) {
  if (!d) return "";
  // Accept "YYYY-MM-DD" without timezone shift.
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(d);
  const dt = new Date(+m[1], +m[2] - 1, +m[3]);
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function calcItemTotal(item) {
  const qty = Number(item.qty) || 0;
  const price = Number(item.price) || 0;
  const base = qty * price;
  const disc = Number(item.discount) || 0;
  if (item.discountType === "%") return base * (1 - disc / 100);
  return Math.max(0, base - disc);
}
function calcTotals(form) {
  const sub = (form.items || []).reduce((s, it) => s + calcItemTotal(it), 0);
  const taxableSub = (form.items || [])
    .filter(it => it.taxable !== false)
    .reduce((s, it) => s + calcItemTotal(it), 0);
  let disc = 0;
  if (form.discount) {
    if (form.discountType === "%") disc = sub * (Number(form.discount) / 100);
    else disc = Number(form.discount);
  }
  const taxBase = Math.max(0, taxableSub - disc * (taxableSub / Math.max(sub, 1)));
  const taxAmt = taxBase * (Number(form.tax) || 0) / 100;
  const total = Math.max(0, sub - disc + taxAmt);
  const paid = (form.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  return { sub, disc, taxAmt, total, paid, balance: total - paid };
}

// jsPDF expects RGB [0–255]; we keep our hex strings as the source of truth.
function hex(c) {
  const m = c.replace("#", "");
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
}
function setFill(doc, c) { const [r, g, b] = hex(c); doc.setFillColor(r, g, b); }
function setText(doc, c) { const [r, g, b] = hex(c); doc.setTextColor(r, g, b); }
function setDraw(doc, c) { const [r, g, b] = hex(c); doc.setDrawColor(r, g, b); }

// Wrap text to a max width and return an array of lines.
function wrap(doc, text, maxWidth) {
  if (!text) return [""];
  return doc.splitTextToSize(String(text), maxWidth);
}

// ── Section drawers ───────────────────────────────────────────────────────

function drawHeader(doc, form) {
  const isEst = form.type === "estimate";
  // Navy band, full-bleed top.
  setFill(doc, NAVY);
  doc.rect(0, 0, PAGE_W, 96, "F");

  // Brand block (left)
  setText(doc, "#ffffff");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text("HI GRADE PLUMBING", MARGIN, 42);

  setText(doc, ORANGE);
  doc.setFontSize(10);
  doc.text("LLC · HONOLULU, HAWAII", MARGIN, 58);

  setText(doc, "#8899bb");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("License #PJ-13579 · (808) 393-0015", MARGIN, 73);
  doc.text("higradeplumbing.com · higradeplumbing@gmail.com", MARGIN, 86);

  // Document type + number (right)
  setText(doc, ORANGE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  const label = isEst ? "ESTIMATE" : "INVOICE";
  const labelW = doc.getTextWidth(label);
  doc.text(label, PAGE_W - MARGIN - labelW, 46);

  setText(doc, "#ffffff");
  doc.setFontSize(14);
  const num = form.id || (isEst ? "EST0000" : "INV0000");
  const numW = doc.getTextWidth(num);
  doc.text(num, PAGE_W - MARGIN - numW, 64);

  // Sub-strip with dates (lighter navy band right under the header).
  setFill(doc, NAVY2);
  doc.rect(0, 96, PAGE_W, 32, "F");

  setText(doc, "#8899bb");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("DATE", MARGIN, 110);
  doc.text("DUE", MARGIN + 130, 110);

  setText(doc, "#dde2ee");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(fmtDate(form.date) || "—", MARGIN, 122);
  doc.text(fmtDate(form.dueDate) || "—", MARGIN + 130, 122);

  // Status pill on the right end of the strip.
  const status = (form.status || (isEst ? "outstanding" : "outstanding")).toUpperCase();
  setText(doc, "#ffffff");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  const sw = doc.getTextWidth(status) + 18;
  setFill(doc, ORANGE);
  doc.roundedRect(PAGE_W - MARGIN - sw, 106, sw, 16, 8, 8, "F");
  doc.text(status, PAGE_W - MARGIN - sw + 9, 117);
}

function drawBillTo(doc, form, y) {
  const data = form.clientInfo || {};
  setText(doc, "#6677aa");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("BILL TO", MARGIN, y);

  setText(doc, TEXT_DARK);
  doc.setFontSize(13);
  doc.text(data.name || form.client || "—", MARGIN, y + 18);

  setText(doc, TEXT_MID);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  let cy = y + 34;
  // Billing address (where the bill is sent — contractor / property manager)
  // and job site (where the work was performed) are shown as two labeled
  // blocks when they differ. Single-location clients collapse to one address.
  // clientInfo carries the flat-field fallback for the billing address.
  const bill = resolveBillTo(form, data);
  const drawAddrLine = (label, lines) => {
    if (!lines.length) return;
    if (label) {
      setText(doc, "#6677aa");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text(label, MARGIN, cy);
      cy += 12;
    }
    setText(doc, TEXT_MID);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text(lines.join(", "), MARGIN, cy);
    cy += 16;
  };
  if (bill.split) {
    drawAddrLine("BILLING ADDRESS", bill.billing);
    drawAddrLine("JOB SITE", bill.job);
  } else {
    drawAddrLine("", bill.single);
  }
  const contact = [data.phone, data.email].filter(Boolean).join(" · ");
  if (contact) {
    setText(doc, TEXT_LIGHT);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text(contact, MARGIN, cy);
    cy += 14;
  }

  return Math.max(cy, y + 60); // bottom of section
}

function drawItemsTable(doc, form, startY) {
  const items = form.items || [];
  const colDescX = MARGIN;
  const colQtyX = PAGE_W - MARGIN - 200;
  const colPriceX = PAGE_W - MARGIN - 130;
  const colAmtRightX = PAGE_W - MARGIN; // right-align
  const descW = colQtyX - colDescX - 12;

  // Header row
  setFill(doc, NAVY);
  doc.rect(MARGIN, startY, PAGE_W - 2 * MARGIN, 22, "F");
  setText(doc, "#ffffff");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("DESCRIPTION", colDescX + 8, startY + 14);
  doc.text("QTY", colQtyX + 8, startY + 14);
  doc.text("PRICE", colPriceX + 8, startY + 14);
  const amtLabel = "AMOUNT";
  doc.text(amtLabel, colAmtRightX - doc.getTextWidth(amtLabel) - 8, startY + 14);

  let y = startY + 22;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);

  const pageBottom = PAGE_H - MARGIN - 200; // leave room for totals + footer

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    // Compute row height from wrapped name + description.
    const nameLines = wrap(doc, it.name || it.desc || "—", descW);
    const descLines = (it.name && it.desc) ? wrap(doc, it.desc, descW) : [];
    const hasItemDiscount = (Number(it.discount) || 0) > 0;
    const rowH = Math.max(28, 14 + nameLines.length * 14 + descLines.length * 12 + 8 + (hasItemDiscount ? 13 : 0));

    // New page if we'd overflow.
    if (y + rowH > pageBottom) {
      doc.addPage();
      drawHeader(doc, form);
      // Re-draw table header on the new page.
      setFill(doc, NAVY);
      doc.rect(MARGIN, 150, PAGE_W - 2 * MARGIN, 22, "F");
      setText(doc, "#ffffff");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("DESCRIPTION", colDescX + 8, 164);
      doc.text("QTY", colQtyX + 8, 164);
      doc.text("PRICE", colPriceX + 8, 164);
      doc.text(amtLabel, colAmtRightX - doc.getTextWidth(amtLabel) - 8, 164);
      y = 172;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
    }

    // Zebra-stripe alternate rows for readability on paper.
    if (i % 2 === 1) {
      setFill(doc, ROW_ALT);
      doc.rect(MARGIN, y, PAGE_W - 2 * MARGIN, rowH, "F");
    }

    // Description name (bold)
    setText(doc, TEXT_DARK);
    doc.setFont("helvetica", "bold");
    nameLines.forEach((ln, k) => doc.text(ln, colDescX + 8, y + 16 + k * 14));

    // Description body (smaller, lighter)
    if (descLines.length) {
      setText(doc, TEXT_LIGHT);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      descLines.forEach((ln, k) => doc.text(ln, colDescX + 8, y + 16 + nameLines.length * 14 + k * 12));
      doc.setFontSize(11);
    }

    // Qty / price / amount
    setText(doc, TEXT_DARK);
    doc.setFont("helvetica", "normal");
    doc.text(String(it.qty ?? 1), colQtyX + 8, y + 16);
    doc.text(fmtMoney(it.price), colPriceX + 8, y + 16);
    doc.setFont("helvetica", "bold");
    if (hasItemDiscount) {
      // Original amount crossed out above the discounted total
      const grossAmt = fmtMoney((Number(it.qty) || 1) * (Number(it.price) || 0));
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      setText(doc, "#aaaaaa");
      const grossW = doc.getTextWidth(grossAmt);
      const grossX = colAmtRightX - grossW - 8;
      doc.text(grossAmt, grossX, y + 12);
      setDraw(doc, "#aaaaaa");
      doc.setLineWidth(0.7);
      doc.line(grossX, y + 9.5, grossX + grossW, y + 9.5);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      setText(doc, TEXT_DARK);
      setDraw(doc, RULE);
      doc.setLineWidth(0.5);
      const amt = fmtMoney(calcItemTotal(it));
      doc.text(amt, colAmtRightX - doc.getTextWidth(amt) - 8, y + 24);
    } else {
      const amt = fmtMoney(calcItemTotal(it));
      doc.text(amt, colAmtRightX - doc.getTextWidth(amt) - 8, y + 16);
    }

    // Bottom rule
    setDraw(doc, RULE);
    doc.setLineWidth(0.5);
    doc.line(MARGIN, y + rowH, PAGE_W - MARGIN, y + rowH);

    y += rowH;
  }

  return y;
}

function drawTotals(doc, form, startY, lateFee) {
  const t = calcTotals(form);
  const boxX = PAGE_W - MARGIN - 240;
  const boxW = 240;
  let y = startY + 18;
  const fee = (lateFee && lateFee.fee) || 0;
  const balanceWithFee = Math.max(0, t.balance + fee);

  const line = (label, val, opts = {}) => {
    setText(doc, opts.color || TEXT_MID);
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(opts.size || 11);
    doc.text(label, boxX, y);
    const w = doc.getTextWidth(val);
    doc.text(val, boxX + boxW - w, y);
    y += opts.gap || 18;
  };

  line("Subtotal", fmtMoney(t.sub));
  if (t.disc > 0) {
    const lbl = form.discountType === "%" ? `Discount (${form.discount}%)` : "Discount";
    // jsPDF's default helvetica encoding (WinAnsi) doesn't include the
    // typographic minus sign U+2212; using it produces garbled output
    // (the byte gets decomposed into spaced characters). ASCII hyphen-
    // minus prints correctly and reads identically in this context.
    line(lbl, "-" + fmtMoney(t.disc));
  }
  line(`GET (${form.tax || 0}%)`, fmtMoney(t.taxAmt));

  // Divider
  setDraw(doc, "#cfd5e3");
  doc.setLineWidth(1);
  doc.line(boxX, y - 6, boxX + boxW, y - 6);
  y += 6;

  // Total Due (the headline)
  setText(doc, NAVY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("TOTAL DUE", boxX, y);
  setText(doc, ORANGE);
  doc.setFontSize(18);
  const totalStr = fmtMoney(t.total);
  doc.text(totalStr, boxX + boxW - doc.getTextWidth(totalStr), y);
  y += 22;

  // Paid / Late fee / Balance Due — only if any apply.
  if (t.paid > 0 || fee > 0) {
    setDraw(doc, RULE);
    doc.line(boxX, y - 8, boxX + boxW, y - 8);
    if (t.paid > 0) line("Paid", "-" + fmtMoney(t.paid), { color: "#27ae60" });
    if (fee > 0) line(`Late fee (${lateFee.months}x ${lateFee.rate}%)`, "+" + fmtMoney(fee), { color: ORANGE, bold: true });
    const balColor = balanceWithFee > 0 ? ORANGE : "#27ae60";
    line(balanceWithFee > 0 ? "BALANCE DUE" : "PAID IN FULL", fmtMoney(balanceWithFee), { bold: true, size: 13, color: balColor });
  }

  return y;
}

function drawNotesAndFooter(doc, form, startY, paymentInstructions) {
  let y = startY + 16;
  if (form.notes && form.notes.trim()) {
    setText(doc, "#6677aa");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("NOTES", MARGIN, y);
    y += 14;
    setText(doc, TEXT_MID);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    const lines = wrap(doc, form.notes, PAGE_W - 2 * MARGIN);
    lines.forEach(ln => { doc.text(ln, MARGIN, y); y += 14; });
    y += 8;
  }

  // Payment Instructions (invoices only, never on estimates).
  const isEst = form.type === "estimate";
  if (!isEst && paymentInstructions && paymentInstructions.trim()) {
    // Make sure we have headroom before the navy footer band so the block
    // doesn't crash through it. If not, we fall back to a second page.
    const footerTop = PAGE_H - 64;
    if (y + 18 > footerTop - 80) {
      doc.addPage();
      y = MARGIN;
    }
    setText(doc, NAVY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("PAYMENT INSTRUCTIONS", MARGIN, y);
    y += 14;
    setText(doc, TEXT_MID);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const blocks = paymentInstructions.split(/\n\n+/);
    for (const block of blocks) {
      const lines = wrap(doc, block, PAGE_W - 2 * MARGIN);
      lines.forEach(ln => {
        if (y > PAGE_H - 80) { doc.addPage(); y = MARGIN; }
        doc.text(ln, MARGIN, y);
        y += 13;
      });
      y += 6;
    }
  }

  // Footer band.
  const footerY = PAGE_H - 64;
  setFill(doc, NAVY);
  doc.rect(0, footerY, PAGE_W, 64, "F");
  setText(doc, "#dde2ee");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  const thanks = "Mahalo for your business";
  doc.text(thanks, (PAGE_W - doc.getTextWidth(thanks)) / 2, footerY + 22);

  setText(doc, "#8899bb");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const pay = "Pay via Venmo @HIGP808 · Zelle/PayPal higradeplumbing@gmail.com · Cash · Check";
  doc.text(pay, (PAGE_W - doc.getTextWidth(pay)) / 2, footerY + 38);
  const tag = "HI Grade Plumbing LLC · Honolulu, Hawaii · License #PJ-13579";
  doc.text(tag, (PAGE_W - doc.getTextWidth(tag)) / 2, footerY + 52);
}

// ── Photo helpers ─────────────────────────────────────────────────────────

async function fetchImageAsBase64(url) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ""));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function drawPhotos(doc, form, photos) {
  if (!photos || photos.length === 0) return;

  const before = photos.filter(p => p.type === 'before');
  const after  = photos.filter(p => p.type === 'after');
  const other  = photos.filter(p => p.type === 'other');

  doc.addPage();
  drawHeader(doc, form);

  let y = 158;
  const colW = (PAGE_W - 2 * MARGIN - 16) / 2; // two columns with 16pt gap
  const colH = Math.round(colW * 0.75);          // 4:3 per photo
  const fullW = PAGE_W - 2 * MARGIN;
  const fullH = Math.round(fullW * 0.5);          // 2:1 for other photos

  const pageBottom = PAGE_H - 80;

  // Section header
  setText(doc, "#6677aa");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("JOB PHOTOS", MARGIN, y);
  y += 20;

  // Before / After two-column grid
  if (before.length > 0 || after.length > 0) {
    setText(doc, NAVY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Before", MARGIN, y);
    doc.text("After", MARGIN + colW + 16, y);
    y += 14;

    const rows = Math.max(before.length, after.length);
    for (let i = 0; i < rows; i++) {
      if (y + colH + 20 > pageBottom) { doc.addPage(); drawHeader(doc, form); y = 158; }
      for (const [photo, xOff] of [[before[i], 0], [after[i], colW + 16]]) {
        if (!photo) continue;
        const b64 = await fetchImageAsBase64(photo.url);
        if (b64) {
          const fmt = b64.startsWith('data:image/png') ? 'PNG' : 'JPEG';
          try { doc.addImage(b64, fmt, MARGIN + xOff, y, colW, colH); } catch {}
        }
        if (photo.caption) {
          setText(doc, TEXT_LIGHT);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(9);
          doc.text(photo.caption, MARGIN + xOff, y + colH + 11);
        }
      }
      y += colH + 24;
    }
  }

  // Other — full width
  if (other.length > 0) {
    if (y + 20 > pageBottom) { doc.addPage(); drawHeader(doc, form); y = 158; }
    setText(doc, NAVY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Additional Photos", MARGIN, y);
    y += 14;

    for (const photo of other) {
      if (y + fullH + 20 > pageBottom) { doc.addPage(); drawHeader(doc, form); y = 158; }
      const b64 = await fetchImageAsBase64(photo.url);
      if (b64) {
        const fmt = b64.startsWith('data:image/png') ? 'PNG' : 'JPEG';
        try { doc.addImage(b64, fmt, MARGIN, y, fullW, fullH); } catch {}
      }
      if (photo.caption) {
        setText(doc, TEXT_LIGHT);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.text(photo.caption, MARGIN, y + fullH + 11);
      }
      y += fullH + 24;
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────

export async function buildPrintablePdf(form, opts = {}) {
  const doc = new jsPDF({ unit: "pt", format: "letter", compress: true });

  drawHeader(doc, form);
  const billY = drawBillTo(doc, form, 158);
  const itemsEndY = drawItemsTable(doc, form, billY + 12);
  const totalsEndY = drawTotals(doc, form, itemsEndY, opts.lateFee);
  drawNotesAndFooter(doc, form, totalsEndY, opts.paymentInstructions);
  if (opts.photos?.length) await drawPhotos(doc, form, opts.photos);

  return doc.output("blob");
}

// Convert the PDF blob to a base64 string (no data: prefix), for the email
// attachment payload.
export function pdfBlobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || "");
      const i = s.indexOf("base64,");
      resolve(i >= 0 ? s.slice(i + 7) : "");
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export function pdfFilename(form) {
  const isEst = form.type === "estimate";
  const id = form.id || (isEst ? "Estimate" : "Invoice");
  const name = ((form.clientInfo && form.clientInfo.name) || form.client || "").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
  return name ? `${id}_${name}.pdf` : `${id}.pdf`;
}
