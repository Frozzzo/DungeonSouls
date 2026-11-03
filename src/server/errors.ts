/** Error de dominio con mensaje seguro para mostrar al usuario. */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

/** Registra un error sin exponer detalles sensibles al cliente. */
export function logServerError(context: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[${context}] ${message}`);
}
