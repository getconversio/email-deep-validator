interface Options {
  timeout?: number;
  verifyDomain?: boolean;
  verifyMailbox?: boolean;
}

interface VerifyResult {
  wellFormed: boolean;
  validDomain: boolean;
  validMailbox: boolean | null;
}

export default declare class EmailValidator {
  public constructor(options?: Options);

  public verify(email: string): Promise<VerifyResult>;
}
