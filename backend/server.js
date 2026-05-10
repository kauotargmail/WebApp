const express = require("express");
const multer = require("multer");
const fs = require("fs");
const csv = require("csv-parser");
const nodemailer = require("nodemailer");
const { v4: uuidv4 } = require("uuid");

const app = express();
const upload = multer({ dest: "uploads/" });
const path = require("path"); // <-- add this at the top
// Serve frontend
app.use(express.static(__dirname + "/../frontend"));
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/../frontend/index.html");
});

app.use(express.json());

// Load SMTP accounts
let smtpList = JSON.parse(fs.readFileSync(__dirname + "/smtp.json", "utf-8"));
let smtpIndex = 0;

// Rotate SMTP
function getNextSMTP() {
  const smtp = smtpList[smtpIndex];
  smtpIndex = (smtpIndex + 1) % smtpList.length;
  return smtp;
}

// Send emails
app.post("/send-emails", upload.single("csv"), async (req, res) => {
  const template = req.body.template;
  const fromName = req.body.fromName || "Sender";
  const fromEmail = req.body.fromEmail;

  if (!fromEmail) return res.status(400).json({ error: "From Email is required" });
  if (!req.file) return res.status(400).json({ error: "CSV file is required" });

  const filePath = req.file.path;
  let emails = [];

  fs.createReadStream(filePath)
    .pipe(csv())
    .on("data", (row) => { if (row.email) emails.push(row.email); })
    .on("end", async () => {
      fs.unlinkSync(filePath); // delete temp upload

      let sent = [];
      let failed = [];

      for (let i = 0; i < emails.length; i++) {
        const email = emails[i];
        const smtp = getNextSMTP();

        let html = template;

        html = html.replace(
          "{{tracking_pixel}}",
          `<img src="/open?id=${uuidv4()}" width="1" height="1"/>`
        );

        try {
          const transporter = nodemailer.createTransport({
            host: smtp.host,
            port: smtp.port,
            secure: false,
            auth: { user: smtp.user, pass: smtp.pass },
          });

          await transporter.sendMail({
            from: `"${fromName}" <${fromEmail}>`,
            to: email,
            subject: "Your Subject Here",
            html,
          });

          sent.push(email);
        } catch (err) {
          failed.push({ email, error: err.message });
        }
      }

      res.json({ sent, failed });
    });
});

// Tracking
app.get("/open", (req, res) => {
  console.log("OPEN:", req.query.id);
  const pixel = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
  res.set("Content-Type", "image/gif");
  res.send(pixel);
});

app.get("/click", (req, res) => {
  console.log("CLICK:", req.query.id);
  res.redirect(req.query.url);
});

// Templates
app.get("/templates/list", (req, res) => {
  const files = fs.readdirSync(__dirname + "/../templates");
  res.json(files);
});

app.get("/templates/get", (req, res) => {
  const name = req.query.name;
  if (!name) return res.status(400).send("Missing template name");
  const content = fs.readFileSync(__dirname + `/../templates/${name}`, "utf-8");
  res.send(content);
});

// Start server
app.listen(3000, () => console.log("Server running on port 3000"));