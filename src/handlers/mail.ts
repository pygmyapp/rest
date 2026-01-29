import { createTransport, type SentMessageInfo } from 'nodemailer';
import { mail as config } from '../../config.json';
import crypto from 'crypto';

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

export const sendMail = async (to: string, subject: string, body: string): Promise<SentMessageInfo> => {
  return await transporter.sendMail({
    from: config.from,
    to,
    subject,
    html: body
  });
};

// Send verification email
export const sendEmailVerificationMail = async (to: string, username: string, token: string): Promise<void> => {
  await sendMail(
    to,
    'Verify your Pygmy account',
    `Hi @${username}, welcome to Pygmy. Click the following link to verify your email address: <a href="http://localhost:3000/verify?token=${token}" target="_blank">http://localhost:3000/verify?token=${token}</a>
    `.trimStart()
  );
}

// Validate SMTP server
export const verify = async (): Promise<void> => {
  try {
    await transporter.verify();

    console.log('Connected to SMTP server');
  } catch (error) {
    throw `Failed to connect to SMTP server: ${error}`;
  }
}

// Create and hash a verification token
export const createAndHashToken = (): {
  token: string;
  hash: string;
} => {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = hashToken(token);

  return {
    token,
    hash
  };
}

// Hash token
export const hashToken = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');