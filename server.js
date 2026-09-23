const express = require("express");
const axios = require("axios");
const PDFDocument = require("pdfkit");
const FormData = require("form-data");

const app = express();
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 3000;

/*
|--------------------------------------------------------------------------
| ENVIRONMENT
|--------------------------------------------------------------------------
*/

const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

const COMPANY_NAME =
  process.env.COMPANY_NAME || "Vanguard Traffic Services";

const COMPANY_ADDRESS =
  process.env.COMPANY_ADDRESS || "";

const COMPANY_NUMBER =
  process.env.COMPANY_NUMBER || "";

const PAYMENT_TERMS =
  process.env.PAYMENT_TERMS || "30 days";

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

// Original mirror price column.
const PRICE_MIRROR_COLUMN_ID = "lookup_mm76v66j";

// Formula on the subitem board which resolves the mirrored price.
// Live Monday data confirmed this returns 425 / 50 / 0 / 800.
const PRICE_FORMULA_COLUMN_ID = "formula_mm7eqee4";

const TOTAL_COLUMN_ID = "formula_mm76er3t";

/*
|--------------------------------------------------------------------------
| HELPERS
|--------------------------------------------------------------------------
*/

function requireEnv() {
  const missing = [];

  if (!MONDAY_API_TOKEN) {
    missing.push("MONDAY_API_TOKEN");
  }

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
    throw new Error(
      JSON.stringify(response.data.errors)
    );
  }

  return response.data.data;
}

/*
|--------------------------------------------------------------------------
| COLUMN HELPERS
|--------------------------------------------------------------------------
*/

function getColumn(item, columnId) {
  if (!item || !Array.isArray(item.column_values)) {
    return null;
  }

  return (
    item.column_values.find(
      (column) => column.id === columnId
    ) || null
  );
}

function getBasicText(item, columnId) {
  const column = getColumn(item, columnId);

  if (!column) {
    return "";
  }

  if (
    column.text !== null &&
    column.text !== undefined &&
    String(column.text).trim() !== ""
  ) {
    return String(column.text).trim();
  }

  return "";
}

function getFormulaValue(item, columnId) {
  const column = getColumn(item, columnId);

  if (!column) {
    return "";
  }

  if (
    column.display_value !== null &&
    column.display_value !== undefined &&
    String(column.display_value).trim() !== ""
  ) {
    return String(column.display_value).trim();
  }

  if (
    column.text !== null &&
    column.text !== undefined &&
    String(column.text).trim() !== ""
  ) {
    return String(column.text).trim();
  }

  return "";
}

function getMirrorValue(item, columnId) {
  const column = getColumn(item, columnId);

  if (!column) {
    return "";
  }

  if (
    column.display_value !== null &&
    column.display_value !== undefined
  ) {
    if (Array.isArray(column.display_value)) {
      return column.display_value
        .map((value) => {
          if (value === null || value === undefined) {
            return "";
          }

          if (typeof value === "object") {
            return (
              value.display_value ||
              value.name ||
              value.text ||
              value.value ||
              ""
            );
          }

          return String(value);
        })
        .filter(Boolean)
        .join(", ")
        .trim();
    }

    if (typeof column.display_value === "object") {
      return String(
        column.display_value.display_value ||
          column.display_value.name ||
          column.display_value.text ||
          column.display_value.value ||
          ""
      ).trim();
    }

    const displayValue =
      String(column.display_value).trim();

    if (displayValue) {
      return displayValue;
    }
  }

  if (
    column.text !== null &&
    column.text !== undefined &&
    String(column.text).trim() !== ""
  ) {
    return String(column.text).trim();
  }

  return "";
}

function getLinkedItemName(item, columnId) {
  const column = getColumn(item, columnId);

  if (!column) {
    return "";
  }

  if (
    Array.isArray(column.linked_item_ids) &&
    column.linked_item_ids.length &&
    Array.isArray(column.linked_items) &&
    column.linked_items.length
  ) {
    return column.linked_items
      .map((linkedItem) => linkedItem.name || "")
      .filter(Boolean)
      .join(", ");
  }

  if (
    Array.isArray(column.linked_items) &&
    column.linked_items.length
  ) {
    return column.linked_items
      .map((linkedItem) => linkedItem.name || "")
      .filter(Boolean)
      .join(", ");
  }

  if (
    column.display_value !== null &&
    column.display_value !== undefined
  ) {
    if (Array.isArray(column.display_value)) {
      return column.display_value
        .map((value) => {
          if (typeof value === "object") {
            return value.name || value.display_value || "";
          }

          return String(value || "");
        })
        .filter(Boolean)
        .join(", ");
    }

    const displayValue =
      String(column.display_value).trim();

    if (displayValue) {
      return displayValue;
    }
  }

  return getBasicText(item, columnId);
}

function parseNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return 0;
  }

  let raw = value;

  if (Array.isArray(raw)) {
    raw = raw[0];
  }

  if (
    typeof raw === "object" &&
    raw !== null
  ) {
    raw =
      raw.display_value ??
      raw.value ??
      raw.text ??
      0;
  }

  const cleaned = String(raw)
    .replace(/£/g, "")
    .replace(/,/g, "")
    .replace(/\s/g, "")
    .trim();

  const number = Number(cleaned);

  return Number.isFinite(number)
    ? number
    : 0;
}

function money(value) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(Number(value || 0));
}

function today() {
  return new Date()
    .toISOString()
    .slice(0, 10);
}

/*
|--------------------------------------------------------------------------
| READ MONDAY JOB
|--------------------------------------------------------------------------
|
| Important:
|
| FormulaValue, MirrorValue and BoardRelationValue are queried using
| inline fragments so we can access their typed fields rather than
| relying only on generic "text".
|
*/

async function getJob(itemId) {
  const query = `
    query ($itemIds: [ID!]!) {
      items(ids: $itemIds) {
        id
        name

        board {
          id
        }

        column_values {
          id
          text
          value

          ... on FormulaValue {
            display_value
          }

          ... on MirrorValue {
            display_value
          }

          ... on BoardRelationValue {
            display_value

            linked_item_ids

            linked_items {
              id
              name
            }
          }
        }

        subitems {
          id
          name

          column_values {
            id
            text
            value

            ... on FormulaValue {
              display_value
            }

            ... on MirrorValue {
              display_value
            }

            ... on BoardRelationValue {
              display_value

              linked_item_ids

              linked_items {
                id
                name
              }
            }
          }
        }
      }
    }
  `;

  const data = await mondayGraphQL(
    query,
    {
      itemIds: [String(itemId)],
    }
  );

  if (
    !data ||
    !data.items ||
    !data.items.length
  ) {
    throw new Error(
      `Monday item ${itemId} was not found.`
    );
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
    getFormulaValue(
      item,
      OUR_REFERENCE_COLUMN_ID
    ) ||
    getBasicText(
      item,
      OUR_REFERENCE_COLUMN_ID
    ) ||
    item.name ||
    item.id;

  const customerPO =
    getBasicText(
      item,
      CUSTOMER_PO_COLUMN_ID
    ) || "";

  const lines =
    (item.subitems || []).map(
      (subitem) => {
        /*
        |--------------------------------------------------------------------------
        | RATE
        |--------------------------------------------------------------------------
        |
        | This is a Connect Boards column.
        | We want the NAME of the linked Rates-board item.
        |
        */

        const rate =
          getLinkedItemName(
            subitem,
            RATE_COLUMN_ID
          ) ||
          subitem.name ||
          "";

        /*
        |--------------------------------------------------------------------------
        | DESCRIPTION
        |--------------------------------------------------------------------------
        |
        | Mirror from the Rates board.
        |
        */

        const description =
          getMirrorValue(
            subitem,
            DESCRIPTION_COLUMN_ID
          ) || "";

        /*
        |--------------------------------------------------------------------------
        | QUANTITY
        |--------------------------------------------------------------------------
        */

        const quantity =
          parseNumber(
            getBasicText(
              subitem,
              QUANTITY_COLUMN_ID
            )
          );

        /*
        |--------------------------------------------------------------------------
        | PRICE
        |--------------------------------------------------------------------------
        |
        | First use formula_mm7eqee4.
        |
        | Live Monday inspection confirmed this currently resolves:
        |
        | 2 Way Signals       -> 425
        | TM Plan Same Day    -> 50
        | TTRO                -> 0
        | Large Road Closure  -> 800
        |
        | If the formula ever fails, fall back to the mirrored Price.
        |
        */

        let price =
          parseNumber(
            getFormulaValue(
              subitem,
              PRICE_FORMULA_COLUMN_ID
            )
          );

        if (!price) {
          price =
            parseNumber(
              getMirrorValue(
                subitem,
                PRICE_MIRROR_COLUMN_ID
              )
            );
        }

        /*
        |--------------------------------------------------------------------------
        | TOTAL
        |--------------------------------------------------------------------------
        |
        | Use Monday's Total formula first.
        |
        | If it isn't available through the API, calculate Qty x Price.
        |
        */

        let total =
          parseNumber(
            getFormulaValue(
              subitem,
              TOTAL_COLUMN_ID
            )
          );

        if (
          total === 0 &&
          quantity !== 0 &&
          price !== 0
        ) {
          total =
            quantity * price;
        }

        return {
          id: subitem.id,
          rate,
          description,
          quantity,
          price,
          total,
        };
      }
    );

  const total =
    lines.reduce(
      (sum, line) =>
        sum +
        Number(line.total || 0),
      0
    );

  return {
    itemId: item.id,
    boardId: item.board?.id,
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

function renderDocument(
  data,
  documentType
) {
  return new Promise(
    (resolve, reject) => {
      try {
        const doc =
          new PDFDocument({
            size: "A4",
            margin: 45,
          });

        const chunks = [];

        doc.on(
          "data",
          (chunk) =>
            chunks.push(chunk)
        );

        doc.on(
          "end",
          () =>
            resolve(
              Buffer.concat(chunks)
            )
        );

        doc.on(
          "error",
          reject
        );

        const title =
          documentType === "quote"
            ? "QUOTATION"
            : "INVOICE";

        /*
        |--------------------------------------------------------------------------
        | HEADER
        |--------------------------------------------------------------------------
        */

        doc
          .font("Helvetica-Bold")
          .fontSize(22)
          .text(
            "VANGUARD",
            45,
            45
          );

        doc
          .font("Helvetica")
          .fontSize(9)
          .text(
            COMPANY_NAME,
            45,
            75
          );

        if (COMPANY_ADDRESS) {
          doc.text(
            COMPANY_ADDRESS
          );
        }

        if (COMPANY_NUMBER) {
          doc.text(
            `Company No: ${COMPANY_NUMBER}`
          );
        }

        doc
          .font("Helvetica-Bold")
          .fontSize(24)
          .text(
            title,
            350,
            45,
            {
              width: 210,
              align: "right",
            }
          );

        doc
          .font("Helvetica")
          .fontSize(10)
          .text(
            `Date: ${today()}`,
            350,
            80,
            {
              width: 210,
              align: "right",
            }
          );

        /*
        |--------------------------------------------------------------------------
        | JOB DETAILS
        |--------------------------------------------------------------------------
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
          .text(
            `Reference: ${data.reference}`
          );

        doc.text(
          `Job: ${data.jobName}`
        );

        if (data.customerPO) {
          doc.text(
            `Customer PO: ${data.customerPO}`
          );
        }

        doc.moveDown(1.5);

        /*
        |--------------------------------------------------------------------------
        | TABLE
        |--------------------------------------------------------------------------
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

        doc.text(
          "Item",
          xRate,
          y,
          {
            width: 115,
          }
        );

        doc.text(
          "Description",
          xDescription,
          y,
          {
            width: 200,
          }
        );

        doc.text(
          "Qty",
          xQty,
          y,
          {
            width: 35,
            align: "right",
          }
        );

        doc.text(
          "Price",
          xPrice,
          y,
          {
            width: 60,
            align: "right",
          }
        );

        doc.text(
          "Total",
          xTotal,
          y,
          {
            width: 60,
            align: "right",
          }
        );

        y += 18;

        doc
          .moveTo(45, y)
          .lineTo(560, y)
          .stroke();

        y += 10;

        doc
          .font("Helvetica")
          .fontSize(8);

        for (
          const line of data.lines
        ) {
          const rowHeight = 55;

          if (
            y + rowHeight >
            730
          ) {
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
            String(
              line.quantity
            ),
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
        |--------------------------------------------------------------------------
        | TOTAL
        |--------------------------------------------------------------------------
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
        |--------------------------------------------------------------------------
        | FOOTER
        |--------------------------------------------------------------------------
        */

        doc
          .font("Helvetica")
          .fontSize(8)
          .text(
            documentType ===
              "invoice"
              ? `Payment terms: ${PAYMENT_TERMS}`
              : "Quotation subject to Vanguard Traffic Services terms and conditions.",
            45,
            760,
            {
              width: 515,
              align: "center",
            }
          );

        doc.end();
      } catch (error) {
        reject(error);
      }
    }
  );
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

  const form =
    new FormData();

  const query = `
    mutation ($file: File!) {
      add_file_to_column(
        item_id: ${Number(
          itemId
        )},
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
      contentType:
        "application/pdf",
    }
  );

  const response =
    await axios.post(
      "https://api.monday.com/v2/file",
      form,
      {
        headers: {
          Authorization:
            MONDAY_API_TOKEN,
          ...form.getHeaders(),
        },

        maxContentLength:
          Infinity,

        maxBodyLength:
          Infinity,
      }
    );

  if (response.data.errors) {
    throw new Error(
      JSON.stringify(
        response.data.errors
      )
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
  boardId,
  documentType,
  total
) {
  if (!boardId) {
    throw new Error(
      "Unable to determine Monday board ID."
    );
  }

  const columnValues =
    documentType === "quote"
      ? {
          [QUOTE_VALUE_COLUMN_ID]:
            total,

          [QUOTE_SENT_COLUMN_ID]:
            {
              date: today(),
            },

          [BILLING_COLUMN_ID]:
            {
              label: "Done",
            },
        }
      : {
          [INVOICE_VALUE_COLUMN_ID]:
            total,

          [INVOICE_SENT_COLUMN_ID]:
            {
              date: today(),
            },

          [BILLING_COLUMN_ID]:
            {
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

  await mondayGraphQL(
    mutation,
    {
      boardId:
        String(boardId),

      itemId:
        String(itemId),

      columnValues:
        JSON.stringify(
          columnValues
        ),
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

  const item =
    await getJob(itemId);

  const data =
    buildDocumentData(item);

  if (!data.lines.length) {
    throw new Error(
      "No rate subitems were found for this job."
    );
  }

  /*
   * Safety check.
   *
   * Prevent creation of a £0 document if
   * Monday's rate data fails to resolve.
   */

  if (
    data.total === 0 &&
    data.lines.some(
      (line) =>
        line.quantity > 0
    )
  ) {
    throw new Error(
      "Document total resolved to £0. Generation stopped to prevent an incorrect document."
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
      .replace(
        /[^\w\-]+/g,
        "_"
      )
      .replace(
        /^_+|_+$/g,
        ""
      );

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
    data.boardId,
    documentType,
    data.total
  );

  return {
    ok: true,
    itemId:
      String(itemId),
    documentType,
    filename,
    total:
      data.total,
    lineCount:
      data.lines.length,
  };
}

/*
|--------------------------------------------------------------------------
| ROOT / HEALTH
|--------------------------------------------------------------------------
*/

app.get(
  "/",
  (req, res) => {
    res.json({
      ok: true,
      service:
        "vanguard-monday-document-api",
    });
  }
);

app.get(
  "/health",
  (req, res) => {
    res.json({
      ok: true,
      service:
        "vanguard-monday-document-api",
    });
  }
);

/*
|--------------------------------------------------------------------------
| READ-ONLY TEST
|--------------------------------------------------------------------------
|
| This endpoint DOES NOT:
|
| - create a PDF
| - upload a file
| - modify Monday
|
*/

app.get(
  "/test/:itemId",
  async (req, res) => {
    try {
      const item =
        await getJob(
          req.params.itemId
        );

      const data =
        buildDocumentData(
          item
        );

      res.json({
        ok: true,

        itemId:
          data.itemId,

        jobName:
          data.jobName,

        reference:
          data.reference,

        customerPO:
          data.customerPO,

        lines:
          data.lines,

        total:
          data.total,
      });
    } catch (error) {
      console.error(
        "Read test failed:",
        error.message
      );

      res
        .status(500)
        .json({
          ok: false,
          error:
            error.message,
        });
    }
  }
);

/*
|--------------------------------------------------------------------------
| MANUAL GENERATION
|--------------------------------------------------------------------------
*/

app.post(
  "/generate",
  async (req, res) => {
    try {
      /*
       * Protect this write endpoint.
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

      const {
        itemId,
        documentType,
      } = req.body || {};

      if (!itemId) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              "itemId is required",
          });
      }

      if (
        documentType !==
          "quote" &&
        documentType !==
          "invoice"
      ) {
        return res
          .status(400)
          .json({
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

      res
        .status(500)
        .json({
          ok: false,
          error:
            error.message,
        });
    }
  }
);

/*
|--------------------------------------------------------------------------
| MONDAY DOCUMENT WEBHOOK
|--------------------------------------------------------------------------
*/

app.post(
  "/monday/document",
  async (req, res) => {
    try {
      /*
       * Monday verification challenge must
       * be handled before secret validation.
       */

      if (
        req.body?.challenge
      ) {
        return res.json({
          challenge:
            req.body.challenge,
        });
      }

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

      const item =
        await getJob(itemId);

      const billing =
        getBasicText(
          item,
          BILLING_COLUMN_ID
        );

      let documentType;

      if (
        billing ===
        "Create Quote"
      ) {
        documentType =
          "quote";
      } else if (
        billing ===
        "Create Invoice"
      ) {
        documentType =
          "invoice";
      } else {
        return res.json({
          ok: true,
          ignored: true,
          billing,
        });
      }

      /*
       * Respond to Monday before
       * performing PDF generation.
       */

      res.json({
        ok: true,
        accepted: true,
        itemId:
          String(itemId),
        documentType,
      });

      generateDocument(
        itemId,
        documentType
      ).catch(
        (error) => {
          console.error(
            "Webhook generation failed:",
            error.message
          );
        }
      );
    } catch (error) {
      console.error(
        "Webhook error:",
        error.message
      );

      if (
        !res.headersSent
      ) {
        res
          .status(500)
          .json({
            ok: false,
            error:
              error.message,
          });
      }
    }
  }
);

/*
|--------------------------------------------------------------------------
| LEGACY INVOICE ENDPOINT
|--------------------------------------------------------------------------
*/

app.post(
  "/monday/invoice",
  async (req, res) => {
    try {
      /*
       * Monday challenge first.
       */

      if (
        req.body?.challenge
      ) {
        return res.json({
          challenge:
            req.body.challenge,
        });
      }

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

      const itemId =
        req.body?.event
          ?.pulseId ||
        req.body?.event
          ?.itemId ||
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
        itemId:
          String(itemId),
        documentType:
          "invoice",
      });

      generateDocument(
        itemId,
        "invoice"
      ).catch(
        (error) => {
          console.error(
            "Legacy invoice generation failed:",
            error.message
          );
        }
      );
    } catch (error) {
      console.error(
        "Invoice webhook error:",
        error.message
      );

      if (
        !res.headersSent
      ) {
        res
          .status(500)
          .json({
            ok: false,
            error:
              error.message,
          });
      }
    }
  }
);

/*
|--------------------------------------------------------------------------
| ERROR HANDLER
|--------------------------------------------------------------------------
*/

app.use(
  (
    err,
    req,
    res,
    next
  ) => {
    console.error(
      "Unhandled application error:",
      err
    );

    if (
      res.headersSent
    ) {
      return next(err);
    }

    res
      .status(500)
      .json({
        ok: false,
        error:
          "Internal server error",
      });
  }
);

/*
|--------------------------------------------------------------------------
| START SERVER
|--------------------------------------------------------------------------
|
| IMPORTANT:
| There is ONE app.listen() only.
|
*/

app.listen(
  PORT,
  () => {
    console.log(
      `Vanguard document API running on port ${PORT}`
    );
  }
);
