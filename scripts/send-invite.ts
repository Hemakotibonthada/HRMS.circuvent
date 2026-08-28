import { neon } from '@neondatabase/serverless';
import nodemailer from 'nodemailer';
import crypto from 'crypto';

const sqlHrms = neon('postgresql://hrms_app:1016db71067ef58c8f99ec29a2217dd251020f27ae1a9662@ep-soft-breeze-azxkexyx-pooler.c-3.ap-southeast-1.aws.neon.tech/hrms?sslmode=require');

async function main() {
  const candidateId = 'b0224386-8455-4a90-90b6-e78effeb968d';
  const cands = await sqlHrms`
    SELECT id, first_name, last_name, email, phone, current_designation, org_id
    FROM public.candidates
    WHERE id = ${candidateId}
  `;
  const cand = cands[0];

  const offers = await sqlHrms`
    SELECT id, candidate_id, designation, status, annual_ctc_minor, proposed_start_date
    FROM public.offers
    WHERE candidate_id = ${candidateId}
  `;
  const off = offers[0];

  const secret = "PZ6SRa1VBEt_ot2_6dTUdg9mTecBhehYxqBTYPLRKmqLVhkvI_CYP0cZuNq0hjpb";
  const tokenId = crypto.randomUUID();
  const designation = off?.designation || "Founder & CEO";
  const startDate = "2026-09-01";

  const payload = {
    employeeId: null,
    candidateId: cand.id,
    employmentType: "full_time",
    tokenId,
    displayName: `${cand.first_name} ${cand.last_name}`.trim(),
    employeeCode: "CV-001",
    designation,
    department: "Executive Management",
    exp: Math.floor(Date.now() / 1000) + (14 * 24 * 60 * 60)
  };

  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const token = `${body}.${signature}`;
  const claimUrl = `https://mail.circuvent.com/register?onboarding=${token}`;
  console.log('Claim URL:', claimUrl);

  const transporter = nodemailer.createTransport({
    host: 'mx.circuvent.com',
    port: 587,
    secure: false,
    auth: {
      user: 'noreply@circuvent.com',
      pass: 'tJFxgFDX6j2ydurJoWhHBHZmktxu2aU09Aa'
    },
    requireTLS: true
  });

  const recipients = ['hemakotibonthada@gmail.com', 'the.vema@icloud.com'];

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"/></head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1e293b; background-color: #f8fafc; padding: 24px;">
      <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
        <div style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 32px 24px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">Welcome to Circuvent</h1>
          <p style="color: #e0e7ff; margin: 8px 0 0 0; font-size: 14px;">Set up your company mailbox and workspace access</p>
        </div>
        
        <div style="padding: 32px 24px;">
          <p style="font-size: 16px; margin-top: 0;">Hello <strong>${cand.first_name} ${cand.last_name}</strong>,</p>
          <p style="font-size: 14px; color: #475569;">
            We are delighted to welcome you to Circuvent as <strong>${designation}</strong>. Your offer has been accepted and confirmed, and your employee workspace profile is ready for activation.
          </p>
          
          <div style="background-color: #f1f5f9; border-left: 4px solid #4f46e5; padding: 16px; margin: 24px 0; border-radius: 4px;">
            <p style="margin: 0 0 8px 0; font-size: 13px; color: #64748b;"><strong>Position:</strong> ${designation}</p>
            <p style="margin: 0 0 8px 0; font-size: 13px; color: #64748b;"><strong>Start Date:</strong> ${startDate}</p>
            <p style="margin: 0 0 8px 0; font-size: 13px; color: #64748b;"><strong>Employee Code:</strong> ${payload.employeeCode}</p>
            <p style="margin: 0; font-size: 13px; color: #64748b;"><strong>Department:</strong> ${payload.department}</p>
          </div>

          <p style="font-size: 14px; color: #475569;">
            Please click the button below to choose your official company email address (e.g. <code>hema@circuvent.com</code>) and set your secure password:
          </p>

          <div style="text-align: center; margin: 32px 0;">
            <a href="${claimUrl}" style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 15px; display: inline-block; box-shadow: 0 4px 12px rgba(79, 70, 229, 0.25);">
              Claim Your Company Mailbox &rarr;
            </a>
          </div>

          <p style="font-size: 12px; color: #94a3b8; word-break: break-all; margin-top: 24px;">
            If the button above does not open, copy and paste this link into your browser:<br/>
            <a href="${claimUrl}" style="color: #4f46e5;">${claimUrl}</a>
          </p>
        </div>

        <div style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 16px 24px; text-align: center; font-size: 12px; color: #94a3b8;">
          &copy; ${new Date().getFullYear()} Circuvent Inc. All rights reserved. • Confidential & Proprietary
        </div>
      </div>
    </body>
    </html>
  `;

  for (const to of recipients) {
    console.log(`Sending email to ${to}...`);
    const info = await transporter.sendMail({
      from: 'Circuvent HR <noreply@circuvent.com>',
      to,
      subject: 'Welcome to Circuvent — Claim Your Company Mailbox & Workspace',
      html,
      text: `Hello ${cand.first_name},\n\nWelcome to Circuvent as ${designation}. Please claim your company mailbox using the following link:\n${claimUrl}\n\nCircuvent HR`
    });
    console.log(`Delivered to ${to}! MessageId:`, info.messageId);
  }
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
