declare module "qrcode-terminal" {
  interface Options {
    small?: boolean;
  }
  function generate(text: string, opts?: Options, callback?: (qr: string) => void): void;
  export = { generate };
}

declare module "localtunnel" {
  interface Tunnel {
    url: string;
    on(event: "error", cb: (err: Error) => void): void;
    on(event: "close", cb: () => void): void;
    close(): void;
  }
  interface Options {
    port: number;
    subdomain?: string;
  }
  function localtunnel(opts: Options): Promise<Tunnel>;
  export default localtunnel;
}
