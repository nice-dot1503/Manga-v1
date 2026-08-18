import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().email().max(255),
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_]+$/, "Username may only contain letters, numbers, and underscores."),
  password: z.string().min(8).max(128),
  turnstileToken: z.string().min(1, "CAPTCHA verification required."),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  // Only required when the login attempt is flagged as suspicious by
  // rate-limiting/heuristics upstream — enforced at the route level.
  turnstileToken: z.string().optional(),
});

export const passwordResetRequestSchema = z.object({
  email: z.string().email(),
  turnstileToken: z.string().min(1, "CAPTCHA verification required."),
});

export const passwordResetConfirmSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

export type RegisterRequest = z.infer<typeof registerSchema>;
export type LoginRequest = z.infer<typeof loginSchema>;
