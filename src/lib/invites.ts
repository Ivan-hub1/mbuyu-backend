import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { prisma } from './prisma';
import { sendStaffInviteEmail, trySendEmail } from './email';

/**
 * Give a user a fresh temporary password and email them their login details.
 * Passwords are stored hashed, so the original one can't be re-sent.
 * If the email fails, the new password is returned so an admin can pass it on.
 * Must run inside the user's tenant context.
 */
export async function resetPasswordAndSendInvite(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;

  const tempPassword = crypto.randomBytes(6).toString('base64url');
  await prisma.user.update({
    where: { id: user.id },
    data: { password: await bcrypt.hash(tempPassword, 10) },
  });

  const result = await trySendEmail(() =>
    sendStaffInviteEmail(user.email, user.name, tempPassword, user.role)
  );
  return {
    email: user.email,
    _emailSent: result.emailSent,
    _emailError: result.emailError,
    // Only revealed when the email didn't go out
    tempPassword: result.emailSent ? null : tempPassword,
  };
}
