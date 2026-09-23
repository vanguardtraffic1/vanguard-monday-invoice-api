const express = require("express");
const axios = require("axios");
const PDFDocument = require("pdfkit");
const FormData = require("form-data");

const app = express();
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 3000;

const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

const COMPANY_NAME = process.env.COMPANY_NAME || "Vanguard Traffic Services";
const COMPANY_ADDRESS = process.env.COMPANY_ADDRESS || "";
const COMPANY_NUMBER = process.env.COMPANY_NUMBER || "";
const PAYMENT_TERMS = process.env.PAYMENT_TERMS || "30 days";

/*
|--------------------------------------------------------------------------
| JOB MASTER COLUMN IDS
|--------------------------------------------------------------------------
*/

const BILLING_COLUMN_ID = "color_mm7e6e42";

const QUOTE_FILES_COLUMN_ID = "file_mm76vz2v";
const QUOTE_VALUE_COLUMN_ID = "numeric_mm763s6h";
const QUOTE_SENT_COLUMN_ID = "date_mm76hsd";

const INVOICE_FILES_COLUMN_ID = "file_mm76vjgd";
const INVOICE_VALUE_COLUMN_ID = "numeric_mm76bxdf";
const INVOICE_SENT_COLUMN_ID = "date_mm766vnc";

const CUSTOMER_PO_COLUMN_ID = "text_mm77hx84";
const OUR_REFERENCE_COLUMN_ID = "formula_mm763fdy";

/*
|--------------------------------------------------------------------------
| SUBITEM COLUMN IDS
|--------------------------------------------------------------------------
*/

const RATE_COLUMN_ID = "board_relation_mm76nrce";
const DESCRIPTION_COLUMN_ID = "lookup_mm768ay6";
const QUANTITY_COLUMN_ID = "numeric_mm76kqt5";
const PRICE_COLUMN_ID = "lookup_mm76v66j";
const TOTAL_COLUMN_ID = "formula_mm76er3t";

/*
|--------------------------------------------------------------------------
| HELPERS
|--------------------------------------------------------------------------
*/

function requireEnv() {
  const missing = [];

  if (!MONDAY_API_TOKEN) missing.push("MONDAY_API_TOKEN");
  if (!WEBHOOK_SECRET) missing.push("WEBHOOK_SECRET");

  if (missing.length) {
    throw new Error(
      `Missing environment variables: ${missing.join(", ")}`
    );
  }
}

async function mondayGraphQL(query, variables = {}) {
  requireEnv();

  const response = await axios.post(
    "https://api.monday.com/v2",
    {
      query,
      variables,
    },
    {
      headers: {
        Authorization: MONDAY_API_TOKEN,
        "Content-Type": "application/json",
      },
    }
  );

  if (response.data.errors) {
    throw new Error(JSON.stringify(response.data.errors));
  }

  return response.data.data;
}

function getColumn(item, columnId) {
  return item.column_values?.find((column) => column.id === columnId);
}

function getColumnText(item, columnId) {
  const column = getColumn(item, columnId);

  if (!column) return "";

  return column.text || "";
}

function money(value) {
  const number = Number(value || 0);

  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(number);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/*
|--------------------------------------------------------------------------
| READ MONDAY JOB
|--------------------------------------------------------------------------
*/

async function getJob(itemId) {
  const query = `
    query ($itemIds: [ID!]!) {
      items(ids: $itemIds) {
        id
        name

        column_values {
          id
          text
          value
        }

        subitems {
          id
          name

          column_values {
            id
            text
            value
          }
        }
      }
    }
  `;

  const data = await mondayGraphQL(query, {
    itemIds: [String(itemId)],
  });

  if (!data.items || !data.items.length) {
    throw new Error(`Monday item ${itemId} was not found.`);
  }

  return data.items[0];
}

/*
|--------------------------------------------------------------------------
| BUILD DOCUMENT DATA
|--------------------------------------------------------------------------
*/

function buildDocumentData(item) {
  const reference =
    getColumnText(item, OUR_REFERENCE_COLUMN_ID) ||
    item.name ||
    item.id;

  const customerPO =
    getColumnText(item, CUSTOMER_PO_COLUMN_ID) || "";

  const lines = (item.subitems || []).map((subitem) => {
    const rate =
      getColumnText(subitem, RATE_COLUMN_ID) ||
      subitem.name ||
      "";

    const description =
      getColumnText(subitem, DESCRIPTION_COLUMN_ID) || "";

    const quantity =
      Number(
        getColumnText(subitem, QUANTITY_COLUMN_ID) || 0
      );

    const price =
      Number(
        String(
          getColumnText(subitem, PRICE_COLUMN_ID) || 0
        ).replace(/[£,]/g, "")
      );

    let total =
      Number(
        String(
          getColumnText(subitem, TOTAL_COLUMN_ID) || 0
        ).replace(/[£,]/g, "")
      );

    /*
     * Fallback calculation in case Monday's formula text
     * isn't returned through the API.
     */
    if (!total && quantity && price) {
      total = quantity * price;
    }

    return {
      rate,
      description,
      quantity,
      price,
      total,
    };
  });

  const total = lines.reduce(
    (sum, line) => sum + Number(line.total || 0),
    0
  );

  return {
    itemId: item.id,
    jobName: item.name,
    reference,
    customerPO,
    lines,
    total,
  };
}

/*
|--------------------------------------------------------------------------
| PDF GENERATOR
|--------------------------------------------------------------------------
*/

function renderDocument(data, documentType) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 45,
      });

      const chunks = [];

      doc.on("data", (chunk) => chunks.push(chunk));

      doc.on("end", () => {
        resolve(Buffer.concat(chunks));
      });

      doc.on("error", reject);

      const title =
        documentType === "quote"
          ? "QUOTATION"
          : "INVOICE";

      /*
       * HEADER
       */

      doc
        .font("Helvetica-Bold")
        .fontSize(22)
        .text("VANGUARD", 45, 45);

      doc
        .font("Helvetica")
        .fontSize(9)
        .text(COMPANY_NAME, 45, 75);

      if (COMPANY_ADDRESS) {
        doc.text(COMPANY_ADDRESS);
      }

      if (COMPANY_NUMBER) {
        doc.text(`Company No: ${COMPANY_NUMBER}`);
      }

      doc
        .font("Helvetica-Bold")
        .fontSize(24)
        .text(title, 350, 45, {
          align: "right",
        });

      doc
        .font("Helvetica")
        .fontSize(10)
        .text(
          `Date: ${today()}`,
          350,
          80,
          {
            align: "right",
          }
        );

      /*
       * JOB INFORMATION
       */

      doc.moveDown(4);

      doc
        .font("Helvetica-Bold")
        .fontSize(11)
        .text("Job Details");

      doc.moveDown(0.5);

      doc
        .font("Helvetica")
        .fontSize(10)
        .text(`Reference: ${data.reference}`);

      doc.text(`Job: ${data.jobName}`);

      if (data.customerPO) {
        doc.text(`Customer PO: ${data.customerPO}`);
      }

      doc.moveDown(1.5);

      /*
       * TABLE HEADER
       */

      const xRate = 45;
      const xDescription = 170;
      const xQty = 385;
      const xPrice = 430;
      const xTotal = 500;

      let y = doc.y;

      doc
        .font("Helvetica-Bold")
        .fontSize(9);

      doc.text("Item", xRate, y, {
        width: 115,
      });

      doc.text("Description", xDescription, y, {
        width: 200,
      });

      doc.text("Qty", xQty, y, {
        width: 35,
        align: "right",
      });

      doc.text("Price", xPrice, y, {
        width: 60,
        align: "right",
      });

      doc.text("Total", xTotal, y, {
        width: 60,
        align: "right",
      });

      y += 18;

      doc
        .moveTo(45, y)
        .lineTo(560, y)
        .stroke();

      y += 10;

      /*
       * LINE ITEMS
       */

      doc.font("Helvetica").fontSize(8);

      for (const line of data.lines) {
        const rowHeight = 55;

        if (y + rowHeight > 730) {
          doc.addPage();
          y = 50;
        }

        doc.text(
          line.rate,
          xRate,
          y,
          {
            width: 115,
          }
        );

        doc.text(
          line.description,
          xDescription,
          y,
          {
            width: 200,
          }
        );

        doc.text(
          String(line.quantity),
          xQty,
          y,
          {
            width: 35,
            align: "right",
          }
        );

        doc.text(
          money(line.price),
          xPrice,
          y,
          {
            width: 60,
            align: "right",
          }
        );

        doc.text(
          money(line.total),
          xTotal,
          y,
          {
            width: 60,
            align: "right",
          }
        );

        y += rowHeight;
      }

      /*
       * TOTAL
       */

      y += 10;

      doc
        .moveTo(350, y)
        .lineTo(560, y)
        .stroke();

      y += 12;

      doc
        .font("Helvetica-Bold")
        .fontSize(12)
        .text(
          "TOTAL",
          390,
          y
        );

      doc.text(
        money(data.total),
        470,
        y,
        {
          width: 90,
          align: "right",
        }
      );

      /*
       * FOOTER
       */

      doc
        .font("Helvetica")
        .fontSize(8)
        .text(
          documentType === "invoice"
            ? `Payment terms: ${PAYMENT_TERMS}`
            : "Quotation subject to Vanguard Traffic Services terms and conditions.",
          45,
          760,
          {
            align: "center",
            width: 515,
          }
        );

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/*
|--------------------------------------------------------------------------
| UPLOAD PDF TO MONDAY
|--------------------------------------------------------------------------
*/

async function uploadFileToMonday(
  itemId,
  columnId,
  filename,
  pdfBuffer
) {
  requireEnv();

  const form = new FormData();

  const query = `
    mutation ($file: File!) {
      add_file_to_column(
        item_id: ${Number(itemId)},
        column_id: "${columnId}",
        file: $file
      ) {
        id
      }
    }
  `;

  form.append(
    "query",
    query
  );

  form.append(
    "variables[file]",
    pdfBuffer,
    {
      filename,
      contentType: "application/pdf",
    }
  );

  const response = await axios.post(
    "https://api.monday.com/v2/file",
    form,
    {
      headers: {
        Authorization: MONDAY_API_TOKEN,
        ...form.getHeaders(),
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    }
  );

  if (response.data.errors) {
    throw new Error(
      JSON.stringify(response.data.errors)
    );
  }

  return response.data;
}

/*
|--------------------------------------------------------------------------
| UPDATE JOB MASTER
|--------------------------------------------------------------------------
*/

async function updateJobAfterGeneration(
  itemId,
  documentType,
  total
) {
  const columnValues =
    documentType === "quote"
      ? {
          [QUOTE_VALUE_COLUMN_ID]: total,
          [QUOTE_SENT_COLUMN_ID]: {
            date: today(),
          },
          [BILLING_COLUMN_ID]: {
            label: "Done",
          },
        }
      : {
          [INVOICE_VALUE_COLUMN_ID]: total,
          [INVOICE_SENT_COLUMN_ID]: {
            date: today(),
          },
          [BILLING_COLUMN_ID]: {
            label: "Done",
          },
        };

  const mutation = `
    mutation (
      $boardId: ID!,
      $itemId: ID!,
      $columnValues: JSON!
    ) {
      change_multiple_column_values(
        board_id: $boardId,
        item_id: $itemId,
        column_values: $columnValues
      ) {
        id
      }
    }
  `;

  /*
   * We don't need to hard-code the board ID because
   * Monday allows us to retrieve it from the item.
   */

  const boardQuery = `
    query ($itemIds: [ID!]!) {
      items(ids: $itemIds) {
        board {
          id
        }
      }
    }
  `;

  const boardData = await mondayGraphQL(
    boardQuery,
    {
      itemIds: [String(itemId)],
    }
  );

  const boardId =
    boardData.items[0].board.id;

  await mondayGraphQL(
    mutation,
    {
      boardId: String(boardId),
      itemId: String(itemId),
      columnValues:
        JSON.stringify(columnValues),
    }
  );
}

/*
|--------------------------------------------------------------------------
| GENERATE QUOTE / INVOICE
|--------------------------------------------------------------------------
*/

async function generateDocument(
  itemId,
  documentType
) {
  if (
    documentType !== "quote" &&
    documentType !== "invoice"
  ) {
    throw new Error(
      "documentType must be quote or invoice"
    );
  }

  const item = await getJob(itemId);

  const data = buildDocumentData(item);

  if (!data.lines.length) {
    throw new Error(
      "No rate subitems were found for this job."
    );
  }

  const pdfBuffer =
    await renderDocument(
      data,
      documentType
    );

  const columnId =
    documentType === "quote"
      ? QUOTE_FILES_COLUMN_ID
      : INVOICE_FILES_COLUMN_ID;

  const documentLabel =
    documentType === "quote"
      ? "Quote"
      : "Invoice";

  const safeReference =
    String(data.reference)
      .replace(/[^\w\-]+/g, "_");

  const filename =
    `${safeReference} ${documentLabel}.pdf`;

  await uploadFileToMonday(
    itemId,
    columnId,
    filename,
    pdfBuffer
  );

  await updateJobAfterGeneration(
    itemId,
    documentType,
    data.total
  );

  return {
    ok: true,
    itemId,
    documentType,
    filename,
    total: data.total,
    lines: data.lines.length,
  };
}

/*
|--------------------------------------------------------------------------
| HEALTH CHECK
|--------------------------------------------------------------------------
*/

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service:
      "vanguard-monday-document-api",
  });
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service:
      "vanguard-monday-document-api",
  });
});

/*
|--------------------------------------------------------------------------
| MANUAL TEST ENDPOINT
|--------------------------------------------------------------------------
|
| POST:
|
| /generate
|
| {
|   "itemId": "123456789",
|   "documentType": "quote"
| }
|
*/

app.post("/generate", async (req, res) => {
  try {
    requireEnv();

    const {
      itemId,
      documentType,
    } = req.body || {};

    if (!itemId) {
      return res.status(400).json({
        ok: false,
        error: "itemId is required",
      });
    }

    if (
      documentType !== "quote" &&
      documentType !== "invoice"
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "documentType must be quote or invoice",
      });
    }

    const result =
      await generateDocument(
        itemId,
        documentType
      );

    res.json(result);
  } catch (error) {
    console.error(
      "Generate error:",
      error.message
    );

    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

/*
|--------------------------------------------------------------------------
| MONDAY WEBHOOK
|--------------------------------------------------------------------------
*/

app.post(
  "/monday/document",
  async (req, res) => {
    try {
      /*
       * Monday webhook verification
       */

      if (req.body?.challenge) {
        return res.json({
          challenge:
            req.body.challenge,
        });
      }

      /*
       * Optional webhook secret
       */

      const suppliedSecret =
        req.query.secret ||
        req.headers[
          "x-webhook-secret"
        ];

      if (
        WEBHOOK_SECRET &&
        suppliedSecret !==
          WEBHOOK_SECRET
      ) {
        return res
          .status(401)
          .json({
            ok: false,
            error:
              "Invalid webhook secret",
          });
      }

      const event =
        req.body?.event || {};

      const itemId =
        event.pulseId ||
        event.itemId ||
        req.body?.itemId;

      if (!itemId) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              "No Monday item ID received.",
          });
      }

      /*
       * Read the current Billing status
       * directly from Monday.
       */

      const item =
        await getJob(itemId);

      const billing =
        getColumnText(
          item,
          BILLING_COLUMN_ID
        );

      let documentType;

      if (billing === "Create Quote") {
        documentType = "quote";
      } else if (
        billing === "Create Invoice"
      ) {
        documentType = "invoice";
      } else {
        return res.json({
          ok: true,
          ignored: true,
          billing,
        });
      }

      /*
       * Respond to Monday immediately.
       * Generation continues after response.
       */

      res.json({
        ok: true,
        accepted: true,
        itemId,
        documentType,
      });

      generateDocument(
        itemId,
        documentType
      ).catch((error) => {
        console.error(
          "Webhook generation failed:",
          error.message
        );
      });
    } catch (error) {
      console.error(
        "Webhook error:",
        error.message
      );

      if (!res.headersSent) {
        res.status(500).json({
          ok: false,
          error: error.message,
        });
      }
    }
  }
);

/*
|--------------------------------------------------------------------------
| LEGACY INVOICE ENDPOINT
|--------------------------------------------------------------------------
|
| Keep yesterday's endpoint alive while
| we transition the Monday automation.
|
*/

app.post(
  "/monday/invoice",
  async (req, res) => {
    try {
      const suppliedSecret =
        req.query.secret ||
        req.headers[
          "x-webhook-secret"
        ];

      if (
        WEBHOOK_SECRET &&
        suppliedSecret !==
          WEBHOOK_SECRET
      ) {
        return res
          .status(401)
          .json({
            ok: false,
            error:
              "Invalid webhook secret",
          });
      }

      if (req.body?.challenge) {
        return res.json({
          challenge:
            req.body.challenge,
        });
      }

      const itemId =
        req.body?.event?.pulseId ||
        req.body?.event?.itemId ||
        req.body?.itemId;

      if (!itemId) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              "No Monday item ID received.",
          });
      }

      res.json({
        ok: true,
        accepted: true,
        itemId,
        documentType:
          "invoice",
      });

      generateDocument(
        itemId,
        "invoice"
      ).catch((error) => {
        console.error(
          "Legacy invoice generation failed:",
          error.message
        );
      });
    } catch (error) {
      console.error(
        "Invoice webhook error:",
        error.message
      );

      if (!res.headersSent) {
        res.status(500).json({
          ok: false,
          error: error.message,
        });
      }
    }
  }
);

/*
|--------------------------------------------------------------------------
| START SERVER
|--------------------------------------------------------------------------
*/

app.listen(PORT, () => {
  console.log(
    `Vanguard document API running on port ${PORT}`
  );
});

app.listen(process.env.PORT || 10000, () => console.log('Invoice API running'));
