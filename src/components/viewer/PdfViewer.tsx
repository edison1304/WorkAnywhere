import styles from './ArtifactViewer.module.css'

interface Props {
  content: string  // base64 encoded
  fileName: string
}

export function PdfViewer({ content, fileName }: Props) {
  const dataUrl = `data:application/pdf;base64,${content}`

  return (
    <div className={styles.pdfViewer}>
      <div className={styles.pdfHeader}>
        <span>{fileName}</span>
        <a
          href={dataUrl}
          download={fileName}
          className={styles.pdfDownload}
        >
          Download
        </a>
      </div>
      <object
        data={dataUrl}
        type="application/pdf"
        className={styles.pdfObject}
      >
        <div className={styles.pdfFallback}>
          <p>PDF preview not available.</p>
          <a href={dataUrl} download={fileName}>Download PDF</a>
        </div>
      </object>
    </div>
  )
}
