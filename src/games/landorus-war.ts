import type { Player } from "../room-activity";
import { ScriptedGame } from "../room-game-scripted";
import { addPlayers, assertStrictEqual } from "../test/test-tools";
import type { GameCommandDefinitions, GameFileTests, IGameFile } from "../types/games";
import type { IPokemon } from "../types/pokemon-showdown";

const minimumMoves = 20;
const data: {learnsets: Dict<readonly string[]>; moves: string[]; pokemon: string[]} = {
	learnsets: {},
	moves: [],
	pokemon: [],
};

class LandorusWar extends ScriptedGame {
	decoyPokemon: string[] = [];
	playerAliases = new Map<Player, string>();
	playerAliasesList: string[] = [];
	playerPokemon = new Map<Player, IPokemon>();
	pokemonList: string[] = [];
	roundMoves = new Set<Player>();
	roundSuspects = new Set<Player>();
	suspectedPlayers = new Map<Player, number>();

	// eslint-disable-next-line @typescript-eslint/require-await
	static async loadData(): Promise<void> {
		data.moves = Games.getMovesList(x => {
			if (x.id.startsWith('hiddenpower') || (!x.basePower && !x.basePowerCallback)) return false;
			return true;
		}).map(x => x.id);

		for (const pokemon of Games.getPokemonList()) {
			let moves = 0;
			const allPossibleMoves = Dex.getAllPossibleMoves(pokemon);
			for (const move of allPossibleMoves) {
				if (data.moves.includes(move)) {
					moves++;
					if (moves === minimumMoves) break;
				}
			}
			if (moves < minimumMoves) continue;
			data.learnsets[pokemon.id] = allPossibleMoves;
			data.pokemon.push(pokemon.id);
		}
	}

	onRemovePlayer(player: Player): void {
		const alias = this.playerAliases.get(player);
		if (alias) {
			const index = this.playerAliasesList.indexOf(alias);
			if (index !== -1) this.playerAliasesList.splice(index, 1);
		}
	}

	async onStart(): Promise<void> {
		this.say("Now handing out Pokemon!");
		const aliases = this.sampleMany(Dex.getData().trainerClasses, this.getRemainingPlayerCount());
		const pokemonList = this.shuffle(data.pokemon);
		const playerAliases: string[] = [];
		const usedPokemon: string[] = [];
		for (const id in this.players) {
			const player = this.players[id];
			const pokemon = Dex.getExistingPokemon(pokemonList[0]);
			pokemonList.shift();
			usedPokemon.push(pokemon.baseSpecies);
			this.playerPokemon.set(player, pokemon);

			const alias = aliases[0];
			aliases.shift();
			playerAliases.push(alias);
			this.playerAliases.set(player, alias);
			this.playerAliasesList.push(alias);
			player.say("You were assigned the **" + alias + "** trainer class and a **" + pokemon.name + "**!");
		}

		outer:
		for (let i = 0; i < this.playerCount; i++) {
			let decoy = Dex.getExistingPokemon(pokemonList[0]);
			pokemonList.shift();
			while (usedPokemon.includes(decoy.baseSpecies)) {
				if (!pokemonList.length) break outer;

				decoy = Dex.getExistingPokemon(pokemonList[0]);
				pokemonList.shift();
			}

			this.decoyPokemon.push(decoy.name);
			usedPokemon.push(decoy.baseSpecies);
		}

		await this.nextRound();
	}

	// eslint-disable-next-line @typescript-eslint/require-await
	async onNextRound(): Promise<void> {
		const remainingPlayerCount = this.getRemainingPlayerCount();
		if (remainingPlayerCount < 2) return this.end();
		this.roundMoves.clear();
		this.roundSuspects.clear();

		let pokemonList: string[] = [];
		for (const i in this.players) {
			if (!this.players[i].eliminated) pokemonList.push(this.playerPokemon.get(this.players[i])!.name);
		}
		pokemonList = pokemonList.concat(this.decoyPokemon);
		pokemonList.sort();
		this.pokemonList = pokemonList;

		let html = "<div class='infobox'>" + this.getMascotAndNameHtml(" - Round " + this.round) + "<br /><br />";
		html += "<b>Remaining Pokemon</b>: " + this.pokemonList.join(", ") + "<br /><br />";
		html += "<b>Remaining players (" + remainingPlayerCount + ")</b>: " + this.shuffle(this.playerAliasesList).join(", ") +
			"<br /><br />";
		html += "Use <code>" + Config.commandCharacter + "use [move], [trainer class]</code> and <code>" + Config.commandCharacter +
			"suspect [trainer class], [Pokemon]</code> in PMs!";
		html += "</div>";

		const uhtmlName = this.uhtmlBaseName + '-pokemon';
		this.onUhtml(uhtmlName, html, () => {
			this.setTimeout(() => void this.nextRound(), 30 * 1000);
		});
		this.sayUhtmlAuto(uhtmlName, html);
	}

	onEnd(): void {
		const winner = this.getFinalPlayer();

		for (const i in this.players) {
			const player = this.players[i];
			if (player === winner) continue;
			const caught = this.suspectedPlayers.get(player);
			if (caught) this.addBits(player, 50 * caught);
		}

		if (winner) {
			this.winners.set(winner, 1);
			this.addBits(winner, 500);
		}

		this.announceWinners();
	}

	destroyPlayers(): void {
		super.destroyPlayers();

		this.playerAliases.clear();
		this.playerPokemon.clear();
		this.suspectedPlayers.clear();
		this.roundMoves.clear();
		this.roundSuspects.clear();
	}

	getPlayerSummary(player: Player): void {
		if (player.eliminated) return;
		const pokemon = this.playerPokemon.get(player);
		if (!pokemon) return player.say("You have not been assigned a Pokemon yet.");
		const alias = this.playerAliases.get(player);
		if (!alias) return player.say("You have not been assigned an alias yet.");
		player.say("You were assigned **" + pokemon.name + "** and you are the **" + alias + "**!");
	}

	getPlayerByAlias(alias: string, excludedPlayer: Player): Player | null {
		alias = Tools.toId(alias);
		for (const i in this.players) {
			if (this.players[i] !== excludedPlayer && alias === Tools.toId(this.playerAliases.get(this.players[i]))) return this.players[i];
		}
		return null;
	}
}

const commands: GameCommandDefinitions<LandorusWar> = {
	use: {
		command(target, room, user) {
			const player = this.players[user.id];
			if (this.roundMoves.has(player)) {
				player.say("You have already used a move this round!");
				return false;
			}

			const targets = target.split(",");
			if (targets.length < 2) {
				player.say("You must specify a move and a trainer class.");
				return false;
			}

			const move = Dex.getMove(targets[0]);
			if (!move) {
				player.say(CommandParser.getErrorText(['invalidMove', targets[0]]));
				return false;
			}
			if (!data.moves.includes(move.id)) {
				player.say("**" + move.name + "** cannot be used in this game.");
				return false;
			}

			const playerPokemon = this.playerPokemon.get(player)!;
			if (!data.learnsets[playerPokemon.id].includes(move.id) && !data.learnsets[playerPokemon.id].includes('sketch')) {
				player.say(playerPokemon.name + " does not learn **" + move.name + "**.");
				return false;
			}

			const alias = targets.slice(1).join(",");
			if (Tools.toId(alias) === Tools.toId(this.playerAliases.get(player))) {
				player.say("You cannot use a move on yourself!");
				return false;
			}

			const attackedPlayer = this.getPlayerByAlias(alias, player);
			if (!attackedPlayer) {
				player.say("'" + alias + "' is not a trainer class in this game.");
				return false;
			}
			if (attackedPlayer.eliminated) {
				player.say("The player with that trainer class has already been eliminated.");
				return false;
			}

			const attackedPokemon = this.playerPokemon.get(attackedPlayer)!;
			if (Dex.isImmune(move, attackedPokemon)) {
				player.say("The move had no effect!");
			} else {
				const effectiveness = Dex.getEffectiveness(move, attackedPokemon);
				if (effectiveness === 0) {
					player.say("The move was neutral!");
				} else {
					player.say("The move was **" + (2 * Math.abs(effectiveness)) + "x** " +
						(effectiveness < 0 ? "resisted" : "super-effective") + "!");
				}
			}

			this.roundMoves.add(player);
			return true;
		},
		pmGameCommand: true,
	},
	suspect: {
		command(target, room, user) {
			const player = this.players[user.id];
			if (this.roundSuspects.has(player)) {
				player.say("You have already suspected a trainer this round!");
				return false;
			}

			const targets = target.split(",");
			if (targets.length !== 2) {
				player.say("You must specify the player and the Pokemon.");
				return false;
			}

			const alias = targets[0];
			if (Tools.toId(alias) === Tools.toId(this.playerAliases.get(player))) {
				player.say("You cannot suspect yourself!");
				return false;
			}

			const targetPlayer = this.getPlayerByAlias(alias, player);
			if (!targetPlayer) {
				player.say("'" + alias + "' is not a trainer class in this game.");
				return false;
			}
			if (targetPlayer.eliminated) {
				player.say("The player with that trainer class has already been eliminated.");
				return false;
			}

			const pokemon = Dex.getPokemon(targets[1]);
			if (!pokemon) {
				player.say(CommandParser.getErrorText(['invalidPokemon', targets[1]]));
				return false;
			}

			let pokemonInUse = false;
			for (const pokemonInList of this.pokemonList) {
				if (pokemonInList === pokemon.name) {
					pokemonInUse = true;
					break;
				}
			}

			if (!pokemonInUse) {
				player.say("**" + pokemon.name + "** is not a Pokemon in this game.");
				return false;
			}

			const targetPokemon = this.playerPokemon.get(targetPlayer)!;
			if (pokemon.id === targetPokemon.id) {
				const targetAlias = this.playerAliases.get(targetPlayer)!;
				player.say("Correct! " + targetAlias + " was " + targetPlayer.name + ".");
				this.playerAliasesList.splice(this.playerAliasesList.indexOf(targetAlias), 1);
				this.eliminatePlayer(targetPlayer, "You were suspected by " + player.name + "!");
				const suspectedPlayers = this.suspectedPlayers.get(player) || 0;
				this.suspectedPlayers.set(player, suspectedPlayers + 1);
				if (this.getRemainingPlayerCount() < 2) {
					this.say("Only " + player.name + " the " + this.playerAliases.get(player) + " (" +
						this.playerPokemon.get(player)!.name + ") remains!");
					this.setTimeout(() => this.end(), 5000);
					return true;
				}
			} else {
				player.say("Incorrect!");
			}

			this.roundSuspects.add(player);
			return true;
		},
		pmGameCommand: true,
	},
};
commands.summary = Tools.deepClone(Games.getSharedCommands().summary);
commands.summary.aliases = ['role'];

const tests: GameFileTests<LandorusWar> = {
	'it should properly assign aliases and create decoys': {
		config: {
			async: true,
		},
		async test(game): Promise<void> {
			await addPlayers(game, 4);
			await game.start();
			assertStrictEqual(game.playerAliasesList.length, 4);
			assertStrictEqual(game.playerPokemon.size, 4);
			assertStrictEqual(game.decoyPokemon.length, 4);
		},
	},
};

export const game: IGameFile<LandorusWar> = {
	aliases: ['landorus', 'lw'],
	category: 'puzzle',
	class: LandorusWar,
	commandDescriptions: [Config.commandCharacter + "use [move], [trainer]", Config.commandCharacter + "suspect [trainer], [Pokemon]"],
	commands,
	description: "Players try to identify the randomly chosen Pokemon of other players by using moves against them to discover their " +
		"type. Players may only use moves of which the Pokemon they have been randomly assigned to is able to learn.",
	name: "Landorus' War",
	nonTrivialLoadData: true,
	mascot: "Landorus",
	scriptedOnly: true,
	tests,
};
