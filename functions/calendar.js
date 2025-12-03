
const AWS = require('aws-sdk');

// Initialize S3 with environment variables
const s3 = new AWS.S3({
  accessKeyId: process.env.DEFAULT_AWS_ACCESS_KEY,
  secretAccessKey: process.env.DEFAULT_AWS_SECRET_KEY,
  region: process.env.DEFAULT_AWS_REGION
});

function createGoogleEvent(event){
  const appLink = `comgooglecalendar://event?action=CREATE&title=${encodeURIComponent(event.title)}&location=${encodeURIComponent(event.location)}&details=${encodeURIComponent(event.description)}&dates=${event.start}/${event.end}&recur=${encodeURIComponent(event.recur)}`;
  const webLink = `https://calendar.google.com/calendar/r/eventedit?text=${encodeURIComponent(event.title)}&dates=${event.start}/${event.end}&details=${encodeURIComponent(event.description)}&location=${encodeURIComponent(event.location)}&recur=${encodeURIComponent(event.recur)}`;

  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html" },
    body: `
      <script>
        // Try to open Google Calendar app
        window.location.href = "${appLink}";
        // Fallback to web after short delay
        setTimeout(() => { window.location.href = "${webLink}"; }, 800);
      </script>
      <body></body>
    `
  };
}

async function createIphoneEvent(event) {
  // Build ICS
  const icsContent = createIphoneCal(event);

  // sanitize filename (remove spaces, colon, etc.)
  const fileNameRaw = `${event.title.replace(/[-:\s]/g, "")}_${event.start}.ics`;
  console.log("S3 File Name (raw):", fileNameRaw);

  // S3 key should be exact; url must be encoded for safe link
  const s3Key = fileNameRaw;
  const s3UrlEncoded = encodeURIComponent(s3Key);

  // Debug env
  console.log("S3 bucket:", process.env.DEFAULT_S3_BUCKET);
  console.log("S3 region:", process.env.DEFAULT_AWS_REGION);

  const putParams = {
    Bucket: process.env.DEFAULT_S3_BUCKET,
    Key: s3Key,
    Body: icsContent,
    ContentType: 'text/calendar',
    ContentDisposition: `inline; filename="${s3Key}"`
  };

  try {
    console.log("Calling s3.putObject with params (safe):", {
      Bucket: putParams.Bucket,
      Key: putParams.Key,
      ContentType: putParams.ContentType,
      ContentDisposition: putParams.ContentDisposition,
      BodyPreview: putParams.Body.slice(0, 200) + (putParams.Body.length > 200 ? '...[truncated]' : '')
    });

    // IMPORTANT: await the promise so the function doesn't exit early
    const putResult = await s3.putObject(putParams).promise();
    console.log("s3.putObject result:", putResult);

    // verify it exists
    try {
      const head = await s3.headObject({ Bucket: putParams.Bucket, Key: putParams.Key }).promise();
      console.log("headObject OK:", head);
    } catch (headErr) {
      console.error("headObject failed:", headErr && headErr.code, headErr && headErr.message);
      // continue — we'll still return the URL, but log the issue
    }

    // Build a publicly usable URL (encode key portion)
    const s3Url = `https://${putParams.Bucket}.s3.${process.env.DEFAULT_AWS_REGION}.amazonaws.com/${s3UrlEncoded}`;
    console.log("Returning S3 URL:", s3Url);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: s3Url })
    };

  } catch (err) {
    console.error("S3 upload error:", err && err.code, err && err.message);
    if (err && err.stack) console.error(err.stack);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err && err.message, code: err && err.code })
    };
  }
}


function createIphoneCal(event){
  const dtstamp = formatICSDate(new Date());
  const dtstart = event.start.replace(/-|:|\s/g, "");
  const dtend   = event.end.replace(/-|:|\s/g, "");

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Sir Leo Memory Anchor//EN",
    "BEGIN:VEVENT",
    `UID:${Date.now()}@sirleo.com`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    `SUMMARY:${event.title}`,
    `DESCRIPTION:${event.description.replace(/\n/g, "\\n")}`,
    `LOCATION:${event.location}`,
    event.recur,
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");
  
  return ics
}

function pad(n){return n<10?"0"+n:n;}

function formatICSDate(d){
  return d.getUTCFullYear() + pad(d.getUTCMonth()+1) + pad(d.getUTCDate()) + "T" +
         pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + "Z";
}

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const type = params.type || "iPhone"; // default

  // --- Event data ---
  const eventData = {
    start: params.start, // REQUIRED: ISO UTC string, e.g. 20251202T190000Z
    end: params.end,   // REQUIRED: ISO UTC string, e.g. 20251202T200000Z
    title: params.title ? decodeURIComponent(params.title) : "",
    location: params.location ? decodeURIComponent(params.location) : "",
    description: params.description ? decodeURIComponent(params.description) : "",
    recur: "RRULE:FREQ=DAILY;COUNT=3"
  }

  if (!eventData.start || !eventData.end) {
    return { statusCode: 400, body: "start and end parameters are required" };
  }

  if (type.toLowerCase() === "google") {
    return createGoogleEvent(eventData);
  }else if (type.toLowerCase() === "iphone") {
    return createIphoneEvent(eventData);
  }else {
    return { statusCode: 400, body: "Invalid type parameter" };
  }
};
