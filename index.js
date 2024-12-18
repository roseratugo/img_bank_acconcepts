const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
const PDFDocumentKit = require('pdfkit');

// Générez la date actuelle au format YYYY-MM-DD
const currentDate = new Date();
const formattedDate = currentDate.toISOString().split('T')[0]; // Format YYYY-MM-DD

// Dossiers de travail
const inputFolder = './IMG_BANK_ACR_TOTAL';
const compressedFolder = `./IMG_BANK_COMPRESSED_${formattedDate}`;
const pdfFolder = `./output_pdfs_${formattedDate}`;
const finalPDF = `IMG_BANK_ACR_${formattedDate}.pdf`;
const MAX_IMAGE_SIZE_MB = 2;
const TARGET_WIDTH = 1920;
const IMAGES_PER_FILE = 15;

// Crée les dossiers de sortie si nécessaire
if (!fs.existsSync(compressedFolder)) fs.mkdirSync(compressedFolder);
if (!fs.existsSync(pdfFolder)) fs.mkdirSync(pdfFolder);

// Fonction pour vérifier si l'image est valide
async function validateImage(inputPath) {
  try {
    const metadata = await sharp(inputPath).metadata();
    return metadata;
  } catch (error) {
    console.error(`Image invalide : ${inputPath} - ${error.message}`);
    return null;
  }
}

// Fonction pour compresser les images
async function compressImage(inputPath, outputPath) {
  try {
    await sharp(inputPath)
      .resize({ width: TARGET_WIDTH })
      .jpeg({ quality: 80 })
      .toFile(outputPath);
    console.log(`Image compressée : ${outputPath}`);
  } catch (error) {
    console.error(`Erreur de compression : ${inputPath} - ${error.message}`);
  }
}

// Analyse et compression des images
async function analyzeAndCompressImages() {
  const files = fs.readdirSync(inputFolder).filter(file =>
    ['.jpg', '.jpeg', '.png'].includes(path.extname(file).toLowerCase())
  );

  for (const file of files) {
    const inputPath = path.join(inputFolder, file);
    const outputPath = path.join(compressedFolder, file);

    const metadata = await validateImage(inputPath);
    if (!metadata) continue;

    const stats = fs.statSync(inputPath);
    const fileSizeMB = stats.size / (1024 * 1024);

    if (fileSizeMB > MAX_IMAGE_SIZE_MB) {
      console.log(`Compression de l'image : ${file} (${fileSizeMB.toFixed(2)} MB)`);
      await compressImage(inputPath, outputPath);
    } else {
      fs.copyFileSync(inputPath, outputPath);
      console.log(`Image copiée sans compression : ${file}`);
    }
  }
}

// Création des PDF
async function createPDF(images, pdfIndex) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocumentKit({ autoFirstPage: false });
      const outputPDF = path.join(pdfFolder, `IMG_BANK_ACR_${formattedDate}_output_${pdfIndex}.pdf`);
      const outputStream = fs.createWriteStream(outputPDF);
      doc.pipe(outputStream);

      const PAGE_WIDTH = 600;
      const PAGE_HEIGHT = 800;
      const IMAGE_MAX_WIDTH = 150;
      const IMAGE_MAX_HEIGHT = 100;
      const MARGIN_X = 25;
      const MARGIN_Y = 25;
      const SPACING_X = 10;
      const SPACING_Y = 10;

      let x = MARGIN_X;
      let y = MARGIN_Y;

      images.forEach((file, index) => {
        const filePath = path.join(compressedFolder, file);

        try {
          const img = doc.openImage(filePath);

          if (index % IMAGES_PER_FILE === 0) {
            doc.addPage({ size: [PAGE_WIDTH, PAGE_HEIGHT] });
            x = MARGIN_X;
            y = MARGIN_Y;
          }

          const scale = Math.min(IMAGE_MAX_WIDTH / img.width, IMAGE_MAX_HEIGHT / img.height);
          const scaledWidth = img.width * scale;
          const scaledHeight = img.height * scale;

          doc.image(filePath, x, y, { width: scaledWidth, height: scaledHeight });
          doc.fontSize(10).text(path.basename(file), x, y + scaledHeight + 5, {
            width: IMAGE_MAX_WIDTH,
            align: 'center',
          });

          x += IMAGE_MAX_WIDTH + SPACING_X;
          if (x + IMAGE_MAX_WIDTH > PAGE_WIDTH - MARGIN_X) {
            x = MARGIN_X;
            y += IMAGE_MAX_HEIGHT + SPACING_Y + 20;
          }
        } catch (error) {
          console.error(`Erreur lors de l'ajout de l'image ${filePath} : ${error.message}`);
        }
      });

      doc.end();
      outputStream.on('finish', () => resolve(outputPDF));
    } catch (error) {
      reject(error);
    }
  });
}

// Fonction pour générer des PDF à partir des images compressées
async function createPDFsFromImages() {
  const files = fs.readdirSync(compressedFolder).filter(file =>
    ['.jpg', '.jpeg', '.png'].includes(path.extname(file).toLowerCase())
  );

  const tasks = [];
  for (let i = 0; i < files.length; i += IMAGES_PER_FILE) {
    const chunk = files.slice(i, i + IMAGES_PER_FILE);
    tasks.push(createPDF(chunk, Math.floor(i / IMAGES_PER_FILE) + 1));
  }

  const generatedPDFs = await Promise.all(tasks);
  console.log(`PDFs générés : ${generatedPDFs.join(', ')}`);
  return generatedPDFs;
}

// Fusionner les PDF
async function mergePDFs(pdfPaths) {
  const mergedPdf = await PDFDocument.create();

  for (const pdfPath of pdfPaths) {
    const pdfBytes = fs.readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const copiedPages = await mergedPdf.copyPages(pdfDoc, pdfDoc.getPageIndices());
    copiedPages.forEach(page => mergedPdf.addPage(page));
  }

  const mergedPdfBytes = await mergedPdf.save();
  fs.writeFileSync(finalPDF, mergedPdfBytes);
  console.log(`PDF final fusionné : ${finalPDF}`);
}

// Supprimer un dossier et son contenu
function deleteFolder(folderPath) {
  if (fs.existsSync(folderPath)) {
    fs.readdirSync(folderPath).forEach(file => {
      const currentPath = path.join(folderPath, file);
      if (fs.lstatSync(currentPath).isDirectory()) {
        deleteFolder(currentPath);
      } else {
        fs.unlinkSync(currentPath);
      }
    });
    fs.rmdirSync(folderPath);
  }
}

// Processus principal
(async () => {
  try {
    console.log('Début du traitement...');
    await analyzeAndCompressImages();
    const generatedPDFs = await createPDFsFromImages();
    await mergePDFs(generatedPDFs);

    // Supprime les dossiers temporaires
    deleteFolder(compressedFolder);
    deleteFolder(pdfFolder);

    console.log('Traitement terminé avec succès.');
  } catch (error) {
    console.error(`Erreur lors du traitement : ${error.message}`);
  }
})();
