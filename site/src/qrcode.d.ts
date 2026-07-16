declare module 'qrcode' {
  export interface CanvasOptions {
    width?: number;
    margin?: number;
    color?: {
      dark?: string;
      light?: string;
    };
  }

  export function toCanvas(
    canvas: HTMLCanvasElement,
    text: string,
    options?: CanvasOptions,
  ): Promise<void>;
}
