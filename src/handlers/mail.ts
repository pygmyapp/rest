import { createTransport } from 'nodemailer';
import { mail as config } from '../../config.json';

export const transporter = createTransport({
  // @ts-ignore
  host: config.host,
  port: config.port,
  auth: {
    user: config.username,
    pass: config.password
  },
  secure: config.secure
});

export const sendMail = async (to: string, subject: string, body: string) => {
  return await transporter.sendMail({
    from: config.from,
    to,
    subject,
    html: body
  });
};

// Validate SMTP server
(async () => {
  try {
    await transporter.verify();

    console.log('Connected to SMTP server');
  } catch (error) {
    throw `Failed to connect to SMTP server: ${error}`;
  }
})();
