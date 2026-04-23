import { registerOTel } from "@vercel/otel";

export function register() {
  registerOTel({ serviceName: "chatbot" });

  if (typeof process !== "undefined" && process.on) {
    process.on("unhandledRejection", (reason) => {
      console.error("[app] unhandledRejection", reason);
    });
    process.on("uncaughtException", (err) => {
      console.error("[app] uncaughtException", err);
    });
  }
}
