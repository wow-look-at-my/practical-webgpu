export class StructView {
  private readonly _dv: DataView;

  constructor(
    readonly buffer: ArrayBuffer,
    readonly byteOffset = 0,
  ) {
    this._dv = new DataView(buffer, byteOffset);
  }

  protected f32(offset: number): number {
    return this._dv.getFloat32(offset, true);
  }

  protected setF32(offset: number, value: number): void {
    this._dv.setFloat32(offset, value, true);
  }

  protected f32x(offset: number, count: number): Float32Array {
    return new Float32Array(this.buffer, this.byteOffset + offset, count);
  }

  protected setF32x(offset: number, values: ArrayLike<number>): void {
    new Float32Array(this.buffer, this.byteOffset + offset, values.length).set(values);
  }

  protected u32(offset: number): number {
    return this._dv.getUint32(offset, true);
  }

  protected setU32(offset: number, value: number): void {
    this._dv.setUint32(offset, value, true);
  }

  protected i32(offset: number): number {
    return this._dv.getInt32(offset, true);
  }

  protected setI32(offset: number, value: number): void {
    this._dv.setInt32(offset, value, true);
  }
}
