onst express = require("express");
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
  process.env.COMPANY_NAME || "Vanguard Traffic Services LTD";

const COMPANY_ADDRESS =
  process.env.COMPANY_ADDRESS ||
  "66 Paul Street, London, England, United Kingdom, EC2A 4NA";

const COMPANY_NUMBER =
  process.env.COMPANY_NUMBER || "17462744";

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
| ADDITIONAL JOB COLUMN IDS
|--------------------------------------------------------------------------
*/

const CUSTOMER_COLUMN_ID = "board_relation_mm76d0ay";

const CUSTOMER_EMAIL_COLUMN_ID = "lookup_mm77b8ak";

const LOCATION_COLUMN_ID = "location_mm76dnbp";

const W3W_COLUMN_ID = "text_mm76hwm2";

const TM_SPECIFICS_COLUMN_ID = "dropdown_mm76ekzy";

const OPERATIVES_COLUMN_ID = "numeric_mm764crt";

const VEHICLES_COLUMN_ID = "numeric_mm761q8k";

const WORK_PERIOD_COLUMN_ID = "timerange_mm76qd9t";

const WORKING_TIMES_COLUMN_ID = "dropdown_mm76ghan";

const NOTES_COLUMN_ID = "long_textrg15o4gb";

const SURVEY_COLUMN_ID = "boolean_mm76tj7k";

const CAD_COLUMN_ID = "boolean_mm76z0t3";

const PERMIT_COLUMN_ID = "boolean_mm76jrnc";

const DELIVERY_COLUMN_ID = "boolean_mm763j1w";

/*
|--------------------------------------------------------------------------
| SUBITEM COLUMN IDS
|--------------------------------------------------------------------------
*/

const RATE_COLUMN_ID = "board_relation_mm76nrce";

const DESCRIPTION_COLUMN_ID = "lookup_mm768ay6";

const QUANTITY_COLUMN_ID = "numeric_mm76kqt5";

const PRICE_MIRROR_COLUMN_ID = "lookup_mm76v66j";

const PRICE_FORMULA_COLUMN_ID = "formula_mm7eqee4";

const TOTAL_COLUMN_ID = "formula_mm76er3t";

/*
|--------------------------------------------------------------------------
| ENVIRONMENT CHECK
|--------------------------------------------------------------------------
*/

function requireEnv() {
  const missing = [];

  if (!MONDAY_API_TOKEN) {
    missing.push("MONDAY_API_TOKEN");
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing environment variables: ${missing.join(", ")}`
    );
  }
}

/*
|--------------------------------------------------------------------------
| MONDAY GRAPHQL
|--------------------------------------------------------------------------
*/

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
            return (
              value.name ||
              value.display_value ||
              ""
            );
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

function getBooleanValue(item, columnId) {
  const column = getColumn(item, columnId);

  if (!column) {
    return false;
  }

  const text = String(
    column.text || ""
  )
    .trim()
    .toLowerCase();

  if (
    text === "v" ||
    text === "yes" ||
    text === "true" ||
    text === "1" ||
    text === "checked"
  ) {
    return true;
  }

  try {
    if (column.value) {
      const parsed =
        typeof column.value === "string"
          ? JSON.parse(column.value)
          : column.value;

      if (
        parsed === true ||
        parsed?.checked === true
      ) {
        return true;
      }
    }
  } catch (error) {
    // Ignore malformed boolean values.
  }

  return false;
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

function formattedToday() {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date());
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
        const rate =
          getLinkedItemName(
            subitem,
            RATE_COLUMN_ID
          ) ||
          subitem.name ||
          "";

        const description =
          getMirrorValue(
            subitem,
            DESCRIPTION_COLUMN_ID
          ) || "";

        const quantity =
          parseNumber(
            getBasicText(
              subitem,
              QUANTITY_COLUMN_ID
            )
          );

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

    boardId:
      item.board?.id,

    jobName:
      item.name,

    reference,

    customerPO,

    customerName:
      getLinkedItemName(
        item,
        CUSTOMER_COLUMN_ID
      ),

    customerEmail:
      getMirrorValue(
        item,
        CUSTOMER_EMAIL_COLUMN_ID
      ),

    location:
      getBasicText(
        item,
        LOCATION_COLUMN_ID
      ),

    what3words:
      getBasicText(
        item,
        W3W_COLUMN_ID
      ),

    trafficSpecifics:
      getBasicText(
        item,
        TM_SPECIFICS_COLUMN_ID
      ),

    operatives:
      getBasicText(
        item,
        OPERATIVES_COLUMN_ID
      ),

    vehicles:
      getBasicText(
        item,
        VEHICLES_COLUMN_ID
      ),

    workPeriod:
      getBasicText(
        item,
        WORK_PERIOD_COLUMN_ID
      ),

    workingTimes:
      getBasicText(
        item,
        WORKING_TIMES_COLUMN_ID
      ),

    notes:
      getBasicText(
        item,
        NOTES_COLUMN_ID
      ),

    survey:
      getBooleanValue(
        item,
        SURVEY_COLUMN_ID
      ),

    cad:
      getBooleanValue(
        item,
        CAD_COLUMN_ID
      ),

    permitSupport:
      getBooleanValue(
        item,
        PERMIT_COLUMN_ID
      ),

    delivery:
      getBooleanValue(
        item,
        DELIVERY_COLUMN_ID
      ),

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
      const doc =
        new PDFDocument({
          size: "A4",
          margin: 0,
          bufferPages: true,
          info: {
            Title:
              documentType === "quote"
                ? `Quote ${data.reference}`
                : `Invoice ${data.reference}`,

            Author:
              "Vanguard Traffic Services LTD",
          },
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

      /*
      |--------------------------------------------------------------------------
      | BRAND
      |--------------------------------------------------------------------------
      */

      const BLACK = "#080808";
      const DARK_GREY = "#777777";
      const MID_GREY = "#D9D9D9";
      const LIGHT_GREY = "#F2F2F2";
      const WHITE = "#FFFFFF";
      const LIME = "#DFFF00";

      const LEFT = 15;
      const RIGHT = 580;
      const CONTENT_W =
        RIGHT - LEFT;

      const documentTitle =
        documentType === "quote"
          ? "Quote"
          : "Invoice";

      const numberPrefix =
        documentType === "quote"
          ? "Q"
          : "INV";

      const documentNumber =
        `${numberPrefix}-${data.reference}`;

      function safe(
        value,
        fallback = ""
      ) {
        if (
          value === null ||
          value === undefined ||
          String(value).trim() === ""
        ) {
          return fallback;
        }

        return String(value).trim();
      }

      function fillBox(
        x,
        y,
        width,
        height,
        colour
      ) {
        doc
          .save()
          .fillColor(colour)
          .rect(
            x,
            y,
            width,
            height
          )
          .fill()
          .restore();
      }

      function drawLine(
        x1,
        y1,
        x2,
        y2,
        colour = MID_GREY
      ) {
        doc
          .strokeColor(colour)
          .lineWidth(0.5)
          .moveTo(x1, y1)
          .lineTo(x2, y2)
          .stroke();
      }

      function serviceMark(
        value
      ) {
        return value
          ? "YES"
          : "NO";
      }

      /*
      |--------------------------------------------------------------------------
      | HEADER
      |--------------------------------------------------------------------------
      */

    doc
  .font("Helvetica-Bold")
  .fontSize(6.5)
  .text(
    "TRAFFIC SERVICES",
    410,
    43,
    {
      width: 165,
      align: "center",
      characterSpacing: 2.2,
    }
  );

      /*
       * Temporary text-based Vanguard logo.
       * No external file dependency is required.
       */

      doc
        .font("Helvetica-Bold")
        .fontSize(19)
        .text(
          "VANGUARD",
          410,
          20,
          {
            width: 165,
            align: "center",
          }
        );


      /*
      |--------------------------------------------------------------------------
      | CUSTOMER / SUPPLIER DETAILS
      |--------------------------------------------------------------------------
      */

      doc
        .font("Helvetica-Bold")
        .fontSize(9)
        .fillColor(BLACK)
        .text(
          safe(
            data.customerName,
            "Customer"
          ),
          LEFT,
          79
        );

      if (data.customerEmail) {
        doc
          .font("Helvetica")
          .fontSize(8)
          .text(
            data.customerEmail,
            LEFT,
            94,
            {
              width: 320,
            }
          );
      }

      doc
        .font("Helvetica-Bold")
        .fontSize(9)
        .text(
          COMPANY_NAME,
          375,
          79,
          {
            width: 200,
            align: "right",
          }
        );

      doc
        .font("Helvetica")
        .fontSize(7.5)
        .text(
          COMPANY_ADDRESS,
          375,
          94,
          {
            width: 200,
            align: "right",
          }
        );

      doc
        .font("Helvetica-Bold")
        .fontSize(7.5)
        .text(
          `Company number ${COMPANY_NUMBER}`,
          375,
          126,
          {
            width: 200,
            align: "right",
          }
        );

      /*
      |--------------------------------------------------------------------------
      | SUMMARY STRIP
      |--------------------------------------------------------------------------
      */

      const summaryY = 160;

      fillBox(
        LEFT,
        summaryY,
        CONTENT_W,
        17,
        LIGHT_GREY
      );

      const summary =
        [
          {
            label:
              documentType === "quote"
                ? "Quote Total"
                : "Invoice Total",

            value:
              money(data.total),

            x: LEFT,
            width: 150,
          },

          {
            label:
              "Issue date",

            value:
              formattedToday(),

            x: 165,
            width: 105,
          },

          {
            label:
              "Works Reference",

            value:
              data.reference,

            x: 270,
            width: 100,
          },

          {
            label:
              "PO Number",

            value:
              data.customerPO ||
              "-",

            x: 370,
            width: 90,
          },

          {
            label:
              documentType === "quote"
                ? "Quote No."
                : "Invoice No.",

            value:
              documentNumber,

            x: 460,
            width: 115,
          },
        ];

      summary.forEach(
        (field) => {
          doc
            .font(
              "Helvetica-Bold"
            )
            .fontSize(6.5)
            .fillColor(BLACK)
            .text(
              field.label,
              field.x + 2,
              summaryY + 4,
              {
                width:
                  field.width - 4,
              }
            );

          doc
            .fontSize(8.5)
            .text(
              safe(
                field.value,
                "-"
              ),
              field.x + 2,
              summaryY + 21,
              {
                width:
                  field.width - 4,
              }
            );
        }
      );

      /*
      |--------------------------------------------------------------------------
      | REFERENCE / SITE
      |--------------------------------------------------------------------------
      */

      let y = 211;

      fillBox(
        LEFT,
        y,
        CONTENT_W,
        17,
        LIGHT_GREY
      );

      doc
        .font("Helvetica-Bold")
        .fontSize(7)
        .fillColor(BLACK)
        .text(
          "Reference",
          LEFT + 3,
          y + 5
        );

      y += 24;

      doc
        .font("Helvetica-Bold")
        .fontSize(9)
        .text(
          safe(
            data.jobName,
            data.reference
          ),
          LEFT + 3,
          y,
          {
            width:
              CONTENT_W - 6,
          }
        );

      y += 15;

      if (
        data.trafficSpecifics
      ) {
        doc
          .font("Helvetica")
          .fontSize(7.5)
          .text(
            `Traffic Management: ${data.trafficSpecifics}`,
            LEFT + 3,
            y
          );

        y += 12;
      }

      if (data.location) {
        doc
          .font("Helvetica")
          .fontSize(7.5)
          .text(
            data.location,
            LEFT + 3,
            y,
            {
              width:
                CONTENT_W - 6,
            }
          );

        y += 12;
      }

      if (data.what3words) {
        doc
          .font("Helvetica")
          .fontSize(7)
          .text(
            `///${String(
              data.what3words
            ).replace(
              /^\/+/,
              ""
            )}`,
            LEFT + 3,
            y
          );

        y += 11;
      }

      if (data.workPeriod) {
        doc
          .font("Helvetica")
          .fontSize(7)
          .text(
            `Works: ${data.workPeriod}`,
            LEFT + 3,
            y
          );

        y += 11;
      }

      if (data.workingTimes) {
        doc
          .font("Helvetica")
          .fontSize(7)
          .text(
            `Working Hours: ${data.workingTimes}`,
            LEFT + 3,
            y
          );

        y += 11;
      }

      if (
        data.operatives ||
        data.vehicles
      ) {
        doc
          .font("Helvetica")
          .fontSize(7)
          .text(
            `${safe(
              data.operatives,
              "0"
            )} Operative(s)  |  ${safe(
              data.vehicles,
              "0"
            )} Vehicle(s)`,
            LEFT + 3,
            y
          );

        y += 11;
      }

      /*
      |--------------------------------------------------------------------------
      | SERVICE FLAGS
      |--------------------------------------------------------------------------
      */

      y += 8;

      const serviceY = y;

      fillBox(
        LEFT,
        serviceY,
        CONTENT_W,
        17,
        LIGHT_GREY
      );

      const services =
        [
          {
            name:
              "Survey",

            value:
              data.survey,
          },

          {
            name:
              "CAD",

            value:
              data.cad,
          },

          {
            name:
              "Permits",

            value:
              data.permitSupport,
          },

          {
            name:
              "Delivery",

            value:
              data.delivery,
          },
        ];

      const serviceWidth =
        CONTENT_W /
        services.length;

      services.forEach(
        (
          service,
          index
        ) => {
          const x =
            LEFT +
            index *
              serviceWidth;

          doc
            .font(
              "Helvetica-Bold"
            )
            .fontSize(8)
            .fillColor(BLACK)
            .text(
              service.name,
              x,
              serviceY + 5,
              {
                width:
                  serviceWidth,
                align:
                  "center",
              }
            );

          doc
            .font("Helvetica")
            .fontSize(7)
            .text(
              serviceMark(
                service.value
              ),
              x,
              serviceY + 22,
              {
                width:
                  serviceWidth,
                align:
                  "center",
              }
            );
        }
      );

      /*
      |--------------------------------------------------------------------------
      | RATE TABLE
      |--------------------------------------------------------------------------
      */

      y =
        serviceY + 47;

      const columns = {
        code: {
          x: 15,
          width: 95,
        },

        description: {
          x: 110,
          width: 200,
        },

        quantity: {
          x: 310,
          width: 55,
        },

        price: {
          x: 365,
          width: 75,
        },

        tax: {
          x: 440,
          width: 60,
        },

        amount: {
          x: 500,
          width: 80,
        },
      };

      function drawTableHeader(
        tableY
      ) {
        fillBox(
          LEFT,
          tableY,
          CONTENT_W,
          18,
          DARK_GREY
        );

        doc
          .font(
            "Helvetica-Bold"
          )
          .fontSize(7)
          .fillColor(WHITE);

        doc.text(
          "Code",
          columns.code.x + 3,
          tableY + 5,
          {
            width:
              columns.code.width -
              6,
          }
        );

        doc.text(
          "Description",
          columns.description.x +
            3,
          tableY + 5,
          {
            width:
              columns.description
                .width - 6,
          }
        );

        doc.text(
          "Quantity",
          columns.quantity.x,
          tableY + 5,
          {
            width:
              columns.quantity
                .width - 5,
            align: "right",
          }
        );

        doc.text(
          "Price",
          columns.price.x,
          tableY + 5,
          {
            width:
              columns.price.width -
              5,
            align: "right",
          }
        );

        doc.text(
          "Tax",
          columns.tax.x,
          tableY + 5,
          {
            width:
              columns.tax.width -
              5,
            align: "right",
          }
        );

        doc.text(
          "Amount",
          columns.amount.x,
          tableY + 5,
          {
            width:
              columns.amount.width -
              5,
            align: "right",
          }
        );
      }

      drawTableHeader(y);

      y += 18;

      doc
        .font("Helvetica")
        .fontSize(7)
        .fillColor(BLACK);

      for (
        const row of data.lines
      ) {
        const code =
          safe(
            row.rate,
            ""
          );

        const description =
          safe(
            row.description,
            ""
          );

        const codeHeight =
          doc.heightOfString(
            code,
            {
              width:
                columns.code.width -
                8,
            }
          );

        const descriptionHeight =
          doc.heightOfString(
            description,
            {
              width:
                columns.description
                  .width - 8,
            }
          );

        const rowHeight =
          Math.max(
            40,
            codeHeight + 12,
            descriptionHeight +
              12
          );

        if (
          y + rowHeight >
          655
        ) {
          doc.addPage({
            size: "A4",
            margin: 0,
          });

          y = 30;

          drawTableHeader(y);

          y += 18;

          doc
            .font("Helvetica")
            .fontSize(7)
            .fillColor(BLACK);
        }

        doc
          .strokeColor(
            MID_GREY
          )
          .lineWidth(0.5)
          .rect(
            LEFT,
            y,
            CONTENT_W,
            rowHeight
          )
          .stroke();

        [
          columns.description.x,
          columns.quantity.x,
          columns.price.x,
          columns.tax.x,
          columns.amount.x,
        ].forEach(
          (x) => {
            drawLine(
              x,
              y,
              x,
              y + rowHeight
            );
          }
        );

        doc
          .font(
            "Helvetica-Bold"
          )
          .fontSize(7)
          .fillColor(BLACK)
          .text(
            code,
            columns.code.x + 3,
            y + 6,
            {
              width:
                columns.code.width -
                7,
            }
          );

        doc
          .font("Helvetica")
          .fontSize(7)
          .text(
            description,
            columns.description.x +
              3,
            y + 6,
            {
              width:
                columns.description
                  .width - 7,
            }
          );

        doc.text(
          String(
            row.quantity
          ),
          columns.quantity.x,
          y + 6,
          {
            width:
              columns.quantity
                .width - 5,
            align: "right",
          }
        );

        doc.text(
          money(
            row.price
          ),
          columns.price.x,
          y + 6,
          {
            width:
              columns.price.width -
              5,
            align: "right",
          }
        );

        doc.text(
          "20% *",
          columns.tax.x,
          y + 6,
          {
            width:
              columns.tax.width -
              5,
            align: "right",
          }
        );

        doc
          .font(
            "Helvetica-Bold"
          )
          .text(
            money(
              row.total
            ),
            columns.amount.x,
            y + 6,
            {
              width:
                columns.amount
                  .width - 5,
              align: "right",
            }
          );

        y += rowHeight;
      }

      /*
      |--------------------------------------------------------------------------
      | TOTALS
      |--------------------------------------------------------------------------
      */

      y += 22;

      if (y > 680) {
        doc.addPage({
          size: "A4",
          margin: 0,
        });

        y = 45;
      }

      const totalsX = 390;
      const totalsValueX = 500;

      doc
        .font(
          "Helvetica-Oblique"
        )
        .fontSize(6.5)
        .fillColor("#555555")
        .text(
          "* Domestic reverse charge (DRC) applies to items marked.\n" +
            "The customer accounts for VAT to HMRC at 20%.",
          LEFT,
          y,
          {
            width: 320,
          }
        );

      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor(BLACK)
        .text(
          "Subtotal",
          totalsX,
          y,
          {
            width: 105,
          }
        );

      doc.text(
        money(
          data.total
        ),
        totalsValueX,
        y,
        {
          width: 75,
          align: "right",
        }
      );

      y += 24;

      doc.text(
        "Domestic Reverse\nCharge @ 20%",
        totalsX,
        y,
        {
          width: 105,
        }
      );

      doc.text(
        money(0),
        totalsValueX,
        y + 5,
        {
          width: 75,
          align: "right",
        }
      );

      y += 42;

      drawLine(
        totalsX,
        y,
        575,
        y,
        BLACK
      );

      y += 12;

      doc
        .font("Helvetica")
        .fontSize(8)
        .text(
          "Total",
          totalsX,
          y
        );

      doc
        .font(
          "Helvetica-Bold"
        )
        .text(
          money(
            data.total
          ),
          totalsValueX,
          y,
          {
            width: 75,
            align: "right",
          }
        );

      y += 27;

      drawLine(
        totalsX,
        y,
        575,
        y,
        BLACK
      );

      y += 16;

      /*
      |--------------------------------------------------------------------------
      | BACS DETAILS
      |--------------------------------------------------------------------------
      */

      const bacsY = y;

      doc
        .font("Helvetica")
        .fontSize(7)
        .fillColor(BLACK)
        .text(
          "Bank: Tide Business Banking\n" +
            "Account Number: 33763868\n" +
            "Sort Code: 04-06-05\n" +
            "Account Name: Vanguard Traffic Services LTD",
          LEFT,
          bacsY,
          {
            width: 300,
            lineGap: 2,
          }
        );

      /*
      |--------------------------------------------------------------------------
      | LIME TOTAL BAR
      |--------------------------------------------------------------------------
      */

      fillBox(
        totalsX,
        bacsY,
        185,
        31,
        LIME
      );

      doc
        .font(
          "Helvetica-Bold"
        )
        .fontSize(8.5)
        .fillColor(BLACK)
        .text(
          documentType === "quote"
            ? "Quote Total"
            : "Invoice Total",
          totalsX + 7,
          bacsY + 11,
          {
            width: 90,
          }
        );

      doc.text(
        money(
          data.total
        ),
        totalsX + 95,
        bacsY + 11,
        {
          width: 83,
          align: "right",
        }
      );

      /*
      |--------------------------------------------------------------------------
      | NOTES
      |--------------------------------------------------------------------------
      */

      if (
        data.notes &&
        bacsY + 55 < 795
      ) {
        doc
          .font(
            "Helvetica-Bold"
          )
          .fontSize(7)
          .fillColor(BLACK)
          .text(
            "Notes",
            LEFT,
            bacsY + 55
          );

        doc
          .font("Helvetica")
          .fontSize(6.5)
          .text(
            data.notes,
            LEFT,
            bacsY + 66,
            {
              width: 560,
            }
          );
      }

      /*
      |--------------------------------------------------------------------------
      | FOOTER ON EVERY PAGE
      |--------------------------------------------------------------------------
      */

      const range =
        doc.bufferedPageRange();

      for (
        let i = 0;
        i < range.count;
        i++
      ) {
        doc.switchToPage(
          range.start + i
        );

        doc
          .font("Helvetica")
          .fontSize(6)
          .fillColor(
            "#777777"
          )
          .text(
            `${COMPANY_NAME} • Registered in England & Wales No. ${COMPANY_NUMBER}`,
            LEFT,
            815,
            {
              width: 400,
            }
          );

        doc.text(
          `Page ${i + 1} of ${range.count}`,
          470,
          815,
          {
            width: 105,
            align: "right",
          }
        );
      }

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/*
|--------------------------------------------------------------------------
| UPLOAD FILE TO MONDAY
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

  if (
    response.data.errors
  ) {
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
| UPDATE MONDAY AFTER GENERATION
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
| GENERATE DOCUMENT
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

  if (
    !data.lines ||
    !data.lines.length
  ) {
    throw new Error(
      "No rate subitems were found for this job."
    );
  }

  /*
   * Financial safety check.
   *
   * Never create/upload a £0 document when
   * chargeable quantities exist.
   */

  if (
    data.total === 0 &&
    data.lines.some(
      (line) =>
        line.quantity > 0 &&
        line.price > 0
    )
  ) {
    throw new Error(
      "Document total resolved to £0. Generation stopped."
    );
  }

  const pdfBuffer =
    await renderDocument(
      data,
      documentType
    );

  const filesColumnId =
    documentType === "quote"
      ? QUOTE_FILES_COLUMN_ID
      : INVOICE_FILES_COLUMN_ID;

  const documentLabel =
    documentType === "quote"
      ? "Quote"
      : "Invoice";

  const safeReference =
    String(
      data.reference
    )
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
    filesColumnId,
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

    reference:
      data.reference,

    total:
      data.total,

    lineCount:
      data.lines.length,
  };
}

/*
|--------------------------------------------------------------------------
| ROOT
|--------------------------------------------------------------------------
*/

app.get(
  "/",
  (req, res) => {
    res.json({
      ok: true,

      service:
        "vanguard-monday-document-api",

      status:
        "Connected to Monday",
    });
  }
);

/*
|--------------------------------------------------------------------------
| HEALTH
|--------------------------------------------------------------------------
*/

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

        customerName:
          data.customerName,

        location:
          data.location,

        what3words:
          data.what3words,

        trafficSpecifics:
          data.trafficSpecifics,

        operatives:
          data.operatives,

        vehicles:
          data.vehicles,

        workPeriod:
          data.workPeriod,

        survey:
          data.survey,

        cad:
          data.cad,

        permitSupport:
          data.permitSupport,

        delivery:
          data.delivery,

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

      return res.json(
        result
      );
    } catch (error) {
      console.error(
        "Generate failed:",
        error.message
      );

      return res
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
       * Monday verification challenge.
       */

      if (
        req.body &&
        req.body.challenge
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
        req.body?.event ||
        {};

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
              "No Monday item ID received",
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
       * Acknowledge Monday immediately.
       */

      res.json({
        ok: true,

        accepted: true,

        itemId:
          String(itemId),

        documentType,
      });

      /*
       * Generate after acknowledgement.
       */

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
        "Webhook failed:",
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
| LEGACY MONDAY INVOICE ENDPOINT
|--------------------------------------------------------------------------
*/

app.post(
  "/monday/invoice",
  async (req, res) => {
    try {
      if (
        req.body &&
        req.body.challenge
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
              "No Monday item ID received",
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
        "Legacy invoice webhook failed:",
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
| ONE app.listen ONLY.
|--------------------------------------------------------------------------
*/

app.listen(
  PORT,
  () => {
    console.log(
      `Vanguard document API running on port ${PORT}`
    );
  }
);
