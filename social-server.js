
const http = require("http");
const crypto = require("crypto");

const PORT = process.env.PORT || 10000;
const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN || "";
const BUFFER_API_KEY = process.env.BUFFER_API_KEY || "";
const WEBHOOK_SHARED_SECRET = process.env.WEBHOOK_SHARED_SECRET || "";
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "";

const BOARD_ID = "5105002840";
const COL = {
  creative: "file_mm7j6ve",
  copy: "long_text_mm7jjzef",
  platform: "dropdown_mm7j316t",
  publishAt: "date_mm7j2dn3",
  status: "color_mm7j7zt5",
  facebookPosted: "boolean_mm7jtbxa",
  linkedinPosted: "boolean_mm7jv1j6",
  facebookUrl: "link_mm7jfp38",
  linkedinUrl: "link_mm7je3rk",
  publishedAt: "date_mm7jz21s",
  error: "long_text_mm7jc7w2",
  facebookBufferId: "text_mm7jym33",
  linkedinBufferId: "text_mm7jcypv"
};

function send(res, status, obj, headers={}) {
  const body = typeof obj === "string" ? obj : JSON.stringify(obj);
  res.writeHead(status, {"Content-Type":"application/json", ...headers});
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", c => {
      data += c;
      if (data.length > 2_000_000) req.destroy();
    });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

async function monday(query, variables={}) {
  if (!MONDAY_API_TOKEN) throw new Error("MONDAY_API_TOKEN is not configured");
  const r = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: {
      Authorization: MONDAY_API_TOKEN,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({query, variables})
  });
  const j = await r.json();
  if (j.errors) throw new Error("Monday API: " + JSON.stringify(j.errors));
  return j.data;
}

async function buffer(query, variables={}) {
  if (!BUFFER_API_KEY) throw new Error("BUFFER_API_KEY is not configured");
  const r = await fetch("https://api.buffer.com", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + BUFFER_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({query, variables})
  });
  const j = await r.json();
  if (j.errors) throw new Error("Buffer API: " + JSON.stringify(j.errors));
  return j.data;
}

function col(item, id) {
  return (item.column_values || []).find(c => c.id === id) || {};
}

function parseValue(c) {
  try { return c.value ? JSON.parse(c.value) : null; }
  catch { return null; }
}

async function getItem(itemId) {
  const q = `query($ids:[ID!]!){
    items(ids:$ids){
      id
      name
      assets { id name url public_url file_extension }
      column_values { id text value type }
    }
  }`;

  const d = await monday(q, {ids:[String(itemId)]});
  if (!d.items || !d.items[0]) {
    throw new Error("Marketing item not found: " + itemId);
  }
  return d.items[0];
}

async function updateItem(itemId, values) {
  const q = `mutation($board:ID!,$item:ID!,$values:JSON!){
    change_multiple_column_values(
      board_id:$board,
      item_id:$item,
      column_values:$values
    ){id}
  }`;

  return monday(q, {
    board: BOARD_ID,
    item: String(itemId),
    values: JSON.stringify(values)
  });
}

async function addUpdate(itemId, body) {
  const q = `mutation($item:ID!,$body:String!){
    create_update(item_id:$item,body:$body){id}
  }`;
  return monday(q, {item:String(itemId), body});
}

function wallTimeToUtc(date, time, timeZone="Europe/London") {
  const [Y,M,D] = date.split("-").map(Number);
  const [h,m,s=0] = (time || "09:00:00").split(":").map(Number);

  const wanted = Date.UTC(Y, M-1, D, h, m, s);
  let guess = wanted;

  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year:"numeric",
    month:"2-digit",
    day:"2-digit",
    hour:"2-digit",
    minute:"2-digit",
    second:"2-digit",
    hourCycle:"h23"
  });

  for (let i=0; i<3; i++) {
    const p = Object.fromEntries(
      fmt.formatToParts(new Date(guess))
        .filter(x => x.type !== "literal")
        .map(x => [x.type, x.value])
    );

    const represented = Date.UTC(
      +p.year, +p.month-1, +p.day,
      +p.hour, +p.minute, +p.second
    );

    guess += wanted - represented;
  }

  return new Date(guess).toISOString();
}

function signMedia(itemId, assetId, service) {
  const payload = `${itemId}:${assetId}:${service}`;
  return crypto
    .createHmac("sha256", WEBHOOK_SHARED_SECRET)
    .update(payload)
    .digest("hex");
}

function mediaUrl(itemId, asset, service) {
  const sig = signMedia(itemId, asset.id, service);
  const name = encodeURIComponent(asset.name || `asset-${asset.id}`);

  return `${PUBLIC_BASE_URL}/media/${itemId}/${asset.id}/${name}` +
    `?service=${encodeURIComponent(service)}&sig=${sig}`;
}

function assetInput(asset, url) {
  const ext = String(
    asset.file_extension ||
    (asset.name || "").split(".").pop() ||
    ""
  ).toLowerCase();

  if (["jpg","jpeg","png","webp","gif"].includes(ext)) {
    return {image:{url}};
  }

  if (["mp4","mov","m4v","webm"].includes(ext)) {
    return {video:{url}};
  }

  throw new Error(
    `Unsupported creative file type: ${ext || "unknown"}. ` +
    "Use JPG, PNG, WEBP, GIF, MP4, MOV, M4V or WEBM."
  );
}

async function getChannels() {
  const orgs = await buffer(
    `query{account{organizations{id name}}}`
  );

  const list = orgs.account?.organizations || [];
  if (!list.length) throw new Error("No Buffer organization found");

  const orgId =
    process.env.BUFFER_ORGANIZATION_ID ||
    list[0].id;

  const d = await buffer(
    `query($org:OrganizationId!){
      channels(input:{organizationId:$org}){
        id name displayName service isQueuePaused
      }
    }`,
    {org:orgId}
  );

  return d.channels || [];
}

async function scheduleFor(service, item, dueAt, copy, assets) {
  const idCol =
    service === "facebook"
      ? COL.facebookBufferId
      : COL.linkedinBufferId;

  const existing = col(item, idCol).text?.trim();
  if (existing) {
    return {id:existing, reused:true};
  }

  const channels = await getChannels();

  const override =
    service === "facebook"
      ? process.env.BUFFER_FACEBOOK_CHANNEL_ID
      : process.env.BUFFER_LINKEDIN_CHANNEL_ID;

  const matches = override
    ? channels.filter(c => c.id === override)
    : channels.filter(
        c => String(c.service).toLowerCase() === service
      );

  if (matches.length !== 1) {
    throw new Error(
      `${service}: expected exactly one Buffer channel, ` +
      `found ${matches.length}.`
    );
  }

  const channel = matches[0];

  const assetList = assets.map(
    a => assetInput(
      a,
      mediaUrl(item.id, a, service)
    )
  );

  const mutation = `mutation($input:CreatePostInput!){
    createPost(input:$input){
      ... on PostActionSuccess {
        post { id text dueAt }
      }
      ... on MutationError {
        message
      }
    }
  }`;

  const input = {
    text: copy,
    channelId: channel.id,
    schedulingType: "automatic",
    mode: "customScheduled",
    dueAt,
    assets: assetList
  };

  const d = await buffer(mutation, {input});
  const out = d.createPost;

  if (!out?.post?.id) {
    throw new Error(
      `${service}: ${out?.message || "Buffer did not return a post ID"}`
    );
  }

  await updateItem(
    item.id,
    {[idCol]: String(out.post.id)}
  );

  return {
    id: out.post.id,
    dueAt: out.post.dueAt,
    channel: channel.displayName || channel.name
  };
}

async function processItem(itemId) {
  const item = await getItem(itemId);

  const status = col(item, COL.status).text || "";
  if (status !== "Scheduled") {
    return {
      ignored:true,
      reason:`status is ${status || "blank"}`
    };
  }

  const copy = (col(item, COL.copy).text || "").trim();
  if (!copy) throw new Error("Post Copy is blank");

  const platform =
    (col(item, COL.platform).text || "").trim();

  if (!platform) throw new Error("Platform is blank");

  const pv = parseValue(col(item, COL.publishAt));

  if (!pv?.date) {
    throw new Error("Publish At is blank");
  }

  const dueAt = wallTimeToUtc(
    pv.date,
    pv.time || "09:00:00"
  );

  if (
    new Date(dueAt).getTime() <
    Date.now() + 60_000
  ) {
    throw new Error(
      "Publish At must be at least 1 minute in the future"
    );
  }

  const assets = item.assets || [];

  if (!assets.length) {
    throw new Error("Creative file is missing");
  }

  const wanted =
    platform === "Both"
      ? ["facebook","linkedin"]
      : platform === "Facebook"
      ? ["facebook"]
      : platform === "LinkedIn"
      ? ["linkedin"]
      : [];

  if (!wanted.length) {
    throw new Error(
      `Unknown Platform value: ${platform}`
    );
  }

  const results = {};

  for (const service of wanted) {
    results[service] = await scheduleFor(
      service,
      item,
      dueAt,
      copy,
      assets
    );
  }

  await updateItem(
    item.id,
    {[COL.error]:""}
  );

  await addUpdate(
    item.id,
    `Social post queued successfully for ` +
    `${pv.date} ${pv.time || "09:00"} UK time via Buffer. ` +
    Object.entries(results)
      .map(([k,v]) => `${k}: ${v.id}`)
      .join(" | ")
  );

  return {ok:true, dueAt, results};
}

async function markPublishSignal(itemId, service) {
  try {
    const item = await getItem(itemId);

    const pv = parseValue(
      col(item, COL.publishAt)
    );

    if (!pv?.date) return;

    const dueAt = new Date(
      wallTimeToUtc(
        pv.date,
        pv.time || "09:00:00"
      )
    ).getTime();

    if (Date.now() < dueAt - 120000) {
      return;
    }

    const now = new Date();
    const date = now.toISOString().slice(0,10);
    const time = now.toISOString().slice(11,19);

    const vals = {
      [COL.publishedAt]: {date, time}
    };

    if (service === "facebook") {
      vals[COL.facebookPosted] = {"checked":"true"};
    }

    if (service === "linkedin") {
      vals[COL.linkedinPosted] = {"checked":"true"};
    }

    await updateItem(itemId, vals);
  } catch (e) {
    console.error(
      "Publish signal update failed",
      e.message
    );
  }
}

async function serveMedia(req, res, url) {
  const parts =
    url.pathname.split("/").filter(Boolean);

  const itemId = parts[1];
  const assetId = parts[2];

  const service =
    url.searchParams.get("service") || "";

  const sig =
    url.searchParams.get("sig") || "";

  if (
    !itemId ||
    !assetId ||
    !["facebook","linkedin"].includes(service)
  ) {
    return send(
      res,
      400,
      {error:"bad media request"}
    );
  }

  const expected =
    signMedia(itemId, assetId, service);

  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(
      Buffer.from(sig),
      Buffer.from(expected)
    )
  ) {
    return send(
      res,
      403,
      {error:"invalid signature"}
    );
  }

  const item = await getItem(itemId);

  const asset = (item.assets || []).find(
    a => String(a.id) === String(assetId)
  );

  if (!asset) {
    return send(
      res,
      404,
      {error:"asset not found"}
    );
  }

  const source =
    asset.public_url || asset.url;

  if (!source) {
    return send(
      res,
      404,
      {error:"asset URL unavailable"}
    );
  }

  const r = await fetch(source);

  if (!r.ok) {
    return send(
      res,
      502,
      {error:"failed to fetch Monday asset"}
    );
  }

  res.writeHead(200, {
    "Content-Type":
      r.headers.get("content-type") ||
      "application/octet-stream",
    "Cache-Control":"no-store",
    "Content-Disposition":
      `inline; filename="${String(
        asset.name || "creative"
      ).replace(/"/g,"")}"`
  });

  const buf =
    Buffer.from(await r.arrayBuffer());

  res.end(buf);

  markPublishSignal(itemId, service);
}

const server = http.createServer(
  async (req, res) => {
    try {
      const url = new URL(
        req.url,
        PUBLIC_BASE_URL ||
        `http://${req.headers.host}`
      );

      if (
        req.method === "GET" &&
        url.pathname === "/health"
      ) {
        return send(
          res,
          200,
          {
            ok:true,
            service:"Vanguard Social Publisher",
            mondayConfigured:!!MONDAY_API_TOKEN,
            bufferConfigured:!!BUFFER_API_KEY
          }
        );
      }

      if (
        req.method === "GET" &&
        url.pathname.startsWith("/media/")
      ) {
        return await serveMedia(
          req,
          res,
          url
        );
      }

      if (
        req.method === "POST" &&
        url.pathname === "/monday/social"
      ) {
        const body =
          await readBody(req);

        if (body.challenge) {
          return send(
            res,
            200,
            {challenge:body.challenge}
          );
        }

        if (
          url.searchParams.get("secret") !==
          WEBHOOK_SHARED_SECRET
        ) {
          return send(
            res,
            401,
            {error:"invalid secret"}
          );
        }

        const event =
          body.event || {};

        const itemId =
          event.pulseId ||
          event.itemId ||
          body.itemId;

        if (!itemId) {
          return send(
            res,
            400,
            {error:"missing item id"}
          );
        }

        send(
          res,
          200,
          {
            ok:true,
            accepted:true,
            itemId:String(itemId)
          }
        );

        processItem(itemId)
          .catch(async e => {
            console.error(
              "Social processing failed",
              e
            );

            try {
              await updateItem(
                itemId,
                {
                  [COL.error]:e.message,
                  [COL.status]:{"label":"Failed"}
                }
              );
            } catch {}
          });

        return;
      }

      return send(
        res,
        404,
        {error:"not found"}
      );

    } catch (e) {
      console.error(e);

      if (!res.headersSent) {
        send(
          res,
          500,
          {error:e.message}
        );
      }
    }
  }
);

server.listen(
  PORT,
  () => console.log(
    `Vanguard Social Publisher listening on ${PORT}`
  )
);
