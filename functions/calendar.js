
const AWS = require('aws-sdk');

// Initialize S3 with environment variables
const s3 = new AWS.S3({
  accessKeyId: process.env.DEFAULT_AWS_ACCESS_KEY,
  secretAccessKey: process.env.DEFAULT_AWS_SECRET_KEY,
  region: process.env.DEFAULT_AWS_REGION
});

function createGoogleEvent(event){
  const appLink = `comgooglecalendar://event?action=CREATE&title=${encodeURIComponent(event.title)}&location=${encodeURIComponent(event.location)}&details=${encodeURIComponent(event.description)}&dates=${event.start}/${event.end}`;
  const webLink = `https://calendar.google.com/calendar/r/eventedit?text=${encodeURIComponent(event.title)}&dates=${event.start}/${event.end}&details=${encodeURIComponent(event.description)}&location=${encodeURIComponent(event.location)}`;

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

function createIphoneEvent(event){
  const icsContent = createIphoneCal(eventData);
    const fileName = `SirLeoReminder_${eventData.title}_${eventData.start}.ics`;
    s3.putObject({
      Bucket: process.env.DEFAULT_S3_BUCKET,
      Key: fileName,
      Body: icsContent,
      ContentType: 'text/calendar',
    });

    const s3Url = `https://${process.env.DEFAULT_S3_BUCKET}.s3.${process.env.DEFAULT_AWS_REGION}.amazonaws.com/${fileName}`;

    // Redirect to S3 file so iPhone opens Calendar
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: s3Url })
    };
}

function createIphoneCal(event){
  const dtstamp = formatICSDate(new Date());
  const dtstart = event.start.replace(/-|:|\s/g, "");
  const dtend   = event.end.replace(/-|:|\s/g, "");

  // Build VALARM blocks for each reminder
  const alarmBlocks = event.reminders.map(rem => {
    const remUTC = formatICSDate(new Date(rem));
    return [
      "BEGIN:VALARM",
      `TRIGGER;VALUE=DATE-TIME:${remUTC}`,
      "ACTION:DISPLAY",
      `DESCRIPTION:${event.title}`,
      "END:VALARM"
    ].join("\r\n");
  }).join("\r\n");

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
    "DESCRIPTION:Basic Desc", // ${event.description.replace(/\n/g, "\\n")}
    `LOCATION:${event.location}`,
    alarmBlocks,
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
    title: params.title ? decodeURIComponent(params.title) : "",
    location: params.location ? decodeURIComponent(params.location) : "",
    description: params.description ? decodeURIComponent(params.description) : "",
    start: params.start, // REQUIRED: ISO UTC string, e.g. 20251202T190000Z
    end: params.end,   // REQUIRED: ISO UTC string, e.g. 20251202T200000Z
    reminders: params.reminders ? params.reminders.split(",") : []
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
