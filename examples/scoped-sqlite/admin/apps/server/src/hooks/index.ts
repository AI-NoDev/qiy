export interface ServerHooks {
  beforeRequest?(request: Request): void | Promise<void>;
  afterResponse?(request: Request, response: Response): void | Promise<void>;
}
