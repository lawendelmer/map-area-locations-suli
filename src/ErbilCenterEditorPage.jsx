import RegionCenterEditorPage from "./RegionCenterEditorPage";

export default function ErbilCenterEditorPage() {
  return (
    <RegionCenterEditorPage
      regionFolder="Erbil"
      pageTitle="Erbil — ناوەندەکانی قەزا و ناحیە"
      exportZipFilename="erbil-edited-centers.xlsx"
      exportCentersSummaryOnly
    />
  );
}
