import { Link } from "react-router-dom";
import yawnLogo from "../assets/YAWN.svg";

export function AppBrand() {
  return (
    <Link to="/" className="app-brand" title="Yet Another Wormhole Navigator">
      <img src={yawnLogo} alt="YAWN" className="app-brand-logo" />
    </Link>
  );
}
