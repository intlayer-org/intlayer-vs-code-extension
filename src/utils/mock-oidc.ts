
export const getVercelOidcToken = async () => "";
export const getVercelOidcTokenSync = () => "";
export const getContext = () => ({});
export class VercelOidcTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VercelOidcTokenError";
  }
}
