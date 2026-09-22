# Vanguard Monday Invoice API

Creates a branded PDF invoice from a Monday.com item and its subitems, then uploads the PDF back to the item's Files column.

## Render settings

- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Region: Frankfurt

## Required Render environment variables

| Key | Value |
| --- | --- |
| `MONDAY_API_TOKEN` | Monday API token with access to the Job Master board |
| `MONDAY_FILES_COLUMN_ID` | The internal ID of the Files column on the board |
| `WEBHOOK_SECRET` | A long random secret; use Render Generate |

## Recommended company variables

`COMPANY_NAME`, `COMPANY_ADDRESS`, `COMPANY_NUMBER`, `PAYMENT_TERMS`, `BANK_DETAILS`, `INVOICE_PREFIX`

## Trigger URL

`POST /monday/invoice?secret=YOUR_WEBHOOK_SECRET`

Send JSON containing `{ "itemId": "MONDAY_ITEM_ID" }`.

## Monday field titles used

Main item: `Our Reference`, `Customer`, `Customer Email`, `Customer PO`, `Location`, `TM Required`.

Subitems: `Rates`, `Description`, `Quantity`, `Price`, `Total`, `Tax Description`.

The output filename is always `Our Reference Invoice.pdf`.
