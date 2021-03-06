var properties = require ("properties");
var csv = require('csv');
var fs = require('fs');
var commander = require("commander");
require("colors");
var mkdirp = require('mkdirp');

function list(val) {
  return val.split(',');
}

//Procesamos los argumentos recibidos
commander
	.version('0.1.0')
	.usage(': node app.js -i <file> -o <directory> [options]')
    .option('-i, --input <file>', 'CSV File to read')
    .option('-o, --output <directory>', 'Directory to store the generated files. It must be writtable')
	.option('-e, --environment <ENV>', 'Select the environment(s) to generate the properties for. Default LOC,DEV,PRE,PRO', list, ['LOC','DEV','PRE','PRO'])
	//.option('-e, --environment <ENV>', 'Select the environment to generate the properties. Default DEV', 'DEV')
	.option('-s, --section <column>', 'The name of the column to use as Section name. Default: Seccion', 'Seccion')
	.option('-t, --type <type>', 'Type of the generated file(s) [properties | ini | yml | yaml]. Default: properties', 'properties')
    .option('-f, --filterFiles <regexp_files>', 'RegExp to generate only the files that match. Example: files that end with th: th$', '')
	.option('--delimiterChar <char>', 'Character to delimit the columns in the CSV file. Default: #', '#')
	.option('--defaultEnv <col>', 'If the enviroment selected has no value set, select the value from this column. Default: DEV', 'DEV')
  	.parse(process.argv);

var env = commander.environment;
var defaultEnv = commander.defaultEnv;
var extension = '.'+commander.type;
var section = commander.section;
var filterFiles = commander.filterFiles;

//Comprobamos que los parametros de entrada sean correctos
(function checkParameters(commander){
	if (!commander.input ||	!commander.output){
		commander.help();
		process.exit(1);
	}

	console.log("----------------------------------------");
	console.log("Selected Environment: %s".yellow, env.toString().magenta);
	console.log("Default Environment value: %s".yellow, defaultEnv.magenta);
	console.log("Generating ".yellow + extension.magenta + " files".yellow);
	console.log("----------------------------------------");
	
})(commander);

//Variable para generar cada property
var stringifier;

//Codificacion de los ficheros de entrada y salida
var fs_enconding = { encoding: 'utf8' };

//Caracter de Comentario para los ficheros properties de salida
var optionsStr = { comment: "#" };
if (commander.type == "yaml" || commander.type == "yml"){
	optionsStr.separator = ":";
}

//Almacenamos los datos antes de escribirlos a disco
var mapFiles = {};
//Listado de ficheros que se han filtrado. Para mostrarlo al finalizar la ejecución
var filteredFiles = [];

function parseYML(data){
	 data = data.replace(/.IDENTATION./g,"  ");
	 data = data.replace(/.SPACE./g," ");
	 
	 return data;
}

/*
 * Indica si debemos filtrar una columna del fichero de entrada
 * y evitar que se propague en la salida
 */
function filterRow(row){
	if (row['Fichero'] === '\\\\'){
		return true;
	}
}

function hasToWriteFile(filename){
    var res = false;

    if (filename && filename !== ''){
        if (filterFiles === '' || filename.match(filterFiles)){
            res = true; //No tenemos que filtrar el fichero
        }else if (filteredFiles.indexOf(filename) < 0) {
            filteredFiles.push(filename);
        }

    }

    return res;
}

/*
 * Escribe en el fichero 'filename' los datos especificados en 'data'
 */
function writeFileEnvironment(env){
    //Extraemos el directorio de salida, que viene especificado en los parametros de entrada
	var outputDir = commander.output.indexOf('/', commander.output.length - '/'.length) !== -1 ? commander.output : commander.output+'/';
    //Dentro de ese directorio generamos el directorio del entorno
	outputDir = outputDir + env + '/';

	//Si el directorio de destino no existe, lo creamos antes de intentar escribir
	if (!fs.existsSync(outputDir)){
		//fs.mkdirSync(outputDir);
		mkdirp.sync(outputDir, { mode : 0755});
	}

    //Numero de ficheros generados para este entorno
    var generatedFileNumber = 0;

    console.log('Environment: %s'.blue, env);

    //Recorremos nuestro mapa de ficheros y generamos cada fichero para el entorno especificado
    for (var filename in mapFiles[env]){
        //Por cada fichero comprobamos si tenemos que escribirlo o no
        if (hasToWriteFile(filename)) {
            //Preparamos los datos a escribir
            var data = properties.stringify(mapFiles[env][filename], optionsStr);
            if (commander.type === "yaml" || commander.type === "yml"){
            	data = parseYML(data);
            }
            try{
                fs.writeFileSync(outputDir + filename + extension, data, fs_enconding);
                //Si no hay excepcion, el fichero se escribió correctamente
                console.log('Generado: '.green + outputDir + filename + extension);
                generatedFileNumber++;
            }catch(err){
                console.log('Error al escribir el fichero: '.red + outputDir + filename + extension);
                console.log(err);
            }
        }
    }
    console.log(generatedFileNumber > 1 ? 'Generados %s ficheros para el entorno %s'.grey
                                        : 'Generado %s fichero para el entorno %s'.grey
                , generatedFileNumber, env);

    if (filteredFiles.length > 0)
        console.log(filteredFiles.length > 1 ? 'Ignorados %s ficheros para el entorno %s: %s'.grey
                                             : 'Ignorado %s fichero para el entorno %s: %s'.grey
            , filteredFiles.length, env, filteredFiles);

    console.log("----------------------------------------");
}

function processFileForEnvironment(environment){
    //Inicializamos nuestro stringifier
    var stringifier;
    //Nombre del fichero que se esta procesando
    var fileName = '';
    //Nombre de la seccion
    var sectionName = undefined;

    /*
     * Abre el flujo de lectura del fichero csv y procesa una a una cada línea
     */
    fs.createReadStream(commander.input, fs_enconding)
        .pipe(csv.parse({delimiter: '#', columns: true, skip_empty_lines: true, relax:true}))
        .pipe(csv.transform(function (row) {
            //Si el nombre del fichero a procesar cambia, debemos reiniciar las variables
            if (fileName !== row['Fichero']){
                //Actualizamos el nombre del nuevo fichero a generar
                fileName = row['Fichero'];//La proxima vez que el nombre del fichero cambie, será este fichero el que se escriba

                //Si el fichero ya se había procesado antes y tenemos un stringifier inicializado, lo utilizamos
                //Debemos comprobar que mapFiles[environment][fileName] no sea una function: Ejem: mapFiles[environment]['push']
                if (mapFiles[environment] && typeof mapFiles[environment][fileName] !== 'function' && mapFiles[environment][fileName]){
                    stringifier = mapFiles[environment][fileName]; //Esta situación puede darse, si los properties q pertenecen a un fichero no aparecen todos seguidos
                }else{
                    if (!mapFiles[environment]) {
                        mapFiles[environment] = [];
                    }
                    //Reinicializamos nuestro stringifier
                    stringifier = properties.createStringifier();
                    mapFiles[environment][fileName] = stringifier;
                }
            }

            //Si el fichero a escribir no ha cambiado, acumulamos la fila en la variable stringifier
            if (!filterRow(row)){
                // Comprobamos si es necesario añadir alguna sección, Antes de acumular
                if (extension === '.ini' && row[section] !== sectionName){
                    stringifier.section(row[section]);
                    sectionName = row[section];
                }

                row[environment] === '' ? stringifier.property({ key: row['Property'], value: row[defaultEnv], comment: row['Comment']})
                                        : stringifier.property({ key: row['Property'], value: row[environment], comment: row['Comment']});
            }
        }))
        .on('readable', function () {
            //console.log('readable');
            //Sin capturar este evento no salta el evento 'end'
        })
        .on('end', function () {
            //Volcamos el contenido del entorno actual al fichero correspondiente
            writeFileEnvironment(environment);
        })
        .on('error', function (error) {
            console.log("Error: " + error);
        });
}

//Comienza la ejecución de la aplicación
(function main(){
    //Recorre la lista de entornos recibidos por parametro y genera los ficheros para cada uno de ellos
    for (var i=0; i < env.length; i++) {
        processFileForEnvironment(env[i]);
    }
})();